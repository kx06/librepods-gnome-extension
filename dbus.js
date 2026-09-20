import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

const BUS_NAME = 'org.librepods.Service';
const OBJECT_PATH = '/org/librepods/Service';
const INTERFACE = 'org.librepods.Service';

export const LibrePodsDBus = GObject.registerClass(
class LibrePodsDBus extends GObject.Object {
    _init() {
        super._init();
        this._proxy = null;
        this._proxyReady = false;
        this._connecting = false;
        this._callbacks = new Map();
        this._signalHandlers = new Map();
        this._nameOwnerId = null;
        this._retryTimeoutId = null;
    }

    async connect() {
        if (this._proxyReady && this._proxy) {
            return true;
        }

        if (this._connecting) {
            return new Promise((resolve) => {
                this._callbacks.set('connect', resolve);
            });
        }

        this._connecting = true;

        try {
            await this._createProxy();
            this._proxyReady = true;
            this._connecting = false;
            this._callbacks.forEach((resolve) => resolve(true));
            this._callbacks.clear();
            return true;
        } catch (e) {
            this._connecting = false;
            logError('Failed to connect to LibrePods D-Bus service:', e);
            await this._tryStartService();
            // Don't recursively call connect() here - let the name owner watcher handle it
            return false;
        }
    }

    async _createProxy() {
        this._proxy = new Gio.DBusProxy({
            g_bus_type: Gio.BusType.SESSION,
            g_name: BUS_NAME,
            g_object_path: OBJECT_PATH,
            g_interface_name: INTERFACE,
            g_flags: Gio.DBusProxyFlags.NONE,
        });

        await new Promise((resolve, reject) => {
            this._proxy.init_async(GLib.PRIORITY_DEFAULT, null, (proxy, res) => {
                try {
                    proxy.init_finish(res);
                    this._setupSignalHandlers();
                    this._watchNameOwner();
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });

        await this._fetchAllProperties();
    }

    _setupSignalHandlers() {
        const props = [
            'Connected', 'Address', 'DeviceName',
            'BatteryHeadphone', 'BatteryHeadphoneStatus',
            'BatteryLeft', 'BatteryLeftStatus',
            'BatteryRight', 'BatteryRightStatus',
            'BatteryCase', 'BatteryCaseStatus',
            'ListeningMode', 'AllowOff',
            'ConversationDetect', 'PersonalizedVolume',
            'EarPrimary', 'EarSecondary', 'ConversationalAwareness'
        ];

        for (const prop of props) {
            const signalName = prop[0].toLowerCase() + prop.slice(1) + '-changed';
            const handlerId = this._proxy.connect('g-signal', (proxy, sender, signalName, params) => {
                this._emitPropertyChanged(prop, params.get_child_value(0).deep_unpack());
            });
            this._signalHandlers.set(prop, handlerId);
        }
    }

    _watchNameOwner() {
        this._nameOwnerId = Gio.bus_watch_name(
            Gio.BusType.SESSION,
            BUS_NAME,
            Gio.BusNameWatcherFlags.NONE,
            (connection, name, nameOwner) => {
                if (!nameOwner) {
                    log('LibrePods service lost, will reconnect...');
                    this._proxyReady = false;
                    this._proxy = null;
                    this._scheduleReconnect();
                } else if (!this._proxyReady && !this._connecting) {
                    log('LibrePods service reappeared, reconnecting...');
                    this.connect();
                }
            },
            null
        );
    }

    _scheduleReconnect() {
        if (this._retryTimeoutId) {
            GLib.source_remove(this._retryTimeoutId);
        }
        this._retryTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            this.connect();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _tryStartService() {
        try {
            const subprocess = new Gio.Subprocess({
                argv: ['systemctl', '--user', 'start', 'librepods.service'],
                flags: Gio.SubprocessFlags.NONE,
            });
            await new Promise((resolve, reject) => {
                subprocess.wait_async(null, (proc, res) => {
                    try {
                        proc.wait_finish(res);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            log('Started librepods.service');
        } catch (e) {
            logError('Failed to start librepods.service:', e);
        }
    }

    async _fetchAllProperties() {
        if (!this._proxy) return;

        const props = [
            'Connected', 'Address', 'DeviceName',
            'BatteryHeadphone', 'BatteryHeadphoneStatus',
            'BatteryLeft', 'BatteryLeftStatus',
            'BatteryRight', 'BatteryRightStatus',
            'BatteryCase', 'BatteryCaseStatus',
            'ListeningMode', 'AllowOff',
            'ConversationDetect', 'PersonalizedVolume',
            'EarPrimary', 'EarSecondary', 'ConversationalAwareness'
        ];

        for (const prop of props) {
            try {
                const value = await this._callGetProperty(prop);
                this._emitPropertyChanged(prop, value);
            } catch (e) {
                logError(`Failed to fetch ${prop}:`, e);
            }
        }
    }

    _callGetProperty(prop) {
        return new Promise((resolve, reject) => {
            this._proxy.get_property(prop, (proxy, res) => {
                try {
                    const value = proxy.get_property_finish(res);
                    resolve(value.deep_unpack());
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    _emitPropertyChanged(prop, value) {
        const callbacks = this._callbacks.get(prop) || [];
        callbacks.forEach((cb) => cb(value));
    }

    onPropertyChanged(prop, callback) {
        if (!this._callbacks.has(prop)) {
            this._callbacks.set(prop, []);
        }
        this._callbacks.get(prop).push(callback);
    }

    offPropertyChanged(prop, callback) {
        const callbacks = this._callbacks.get(prop) || [];
        const idx = callbacks.indexOf(callback);
        if (idx !== -1) callbacks.splice(idx, 1);
    }

    async callListDevices() {
        await this.connect();
        return new Promise((resolve, reject) => {
            this._proxy.call('ListDevices', null, Gio.DBusCallFlags.NONE, -1, null, (proxy, res) => {
                try {
                    const result = proxy.call_finish(res);
                    const devices = result.deep_unpack();
                    resolve(devices);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async callConnectDevice(address) {
        await this.connect();
        return new Promise((resolve, reject) => {
            const params = new GLib.Variant('(s)', [address]);
            this._proxy.call('ConnectDevice', params, Gio.DBusCallFlags.NONE, -1, null, (proxy, res) => {
                try {
                    proxy.call_finish(res);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async callDisconnectDevice(address) {
        await this.connect();
        return new Promise((resolve, reject) => {
            const params = new GLib.Variant('(s)', [address]);
            this._proxy.call('DisconnectDevice', params, Gio.DBusCallFlags.NONE, -1, null, (proxy, res) => {
                try {
                    proxy.call_finish(res);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async callSetListeningMode(mode) {
        await this.connect();
        const params = new GLib.Variant('(y)', [mode]);
        return this._callMethod('SetListeningMode', params);
    }

    async callSetConversationDetect(enabled) {
        await this.connect();
        const params = new GLib.Variant('(b)', [enabled]);
        return this._callMethod('SetConversationDetect', params);
    }

    async callSetPersonalizedVolume(enabled) {
        await this.connect();
        const params = new GLib.Variant('(b)', [enabled]);
        return this._callMethod('SetPersonalizedVolume', params);
    }

    async callSetAllowOff(enabled) {
        await this.connect();
        const params = new GLib.Variant('(b)', [enabled]);
        return this._callMethod('SetAllowOff', params);
    }

    _callMethod(method, params) {
        return new Promise((resolve, reject) => {
            this._proxy.call(method, params, Gio.DBusCallFlags.NONE, -1, null, (proxy, res) => {
                try {
                    proxy.call_finish(res);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    destroy() {
        if (this._nameOwnerId) {
            Gio.bus_unwatch_name(this._nameOwnerId);
            this._nameOwnerId = null;
        }
        if (this._retryTimeoutId) {
            GLib.source_remove(this._retryTimeoutId);
            this._retryTimeoutId = null;
        }
        if (this._proxy) {
            for (const [prop, handlerId] of this._signalHandlers) {
                this._proxy.disconnect(handlerId);
            }
            this._signalHandlers.clear();
            this._proxy = null;
        }
        this._proxyReady = false;
        this._callbacks.clear();
    }
});

let _dbusInstance = null;

export function getDBus() {
    if (!_dbusInstance) {
        _dbusInstance = new LibrePodsDBus();
    }
    return _dbusInstance;
}

function log(msg) {
    console.log(`[LibrePods] ${msg}`);
}

function logError(msg, error) {
    console.error(`[LibrePods] ${msg}`, error);
}