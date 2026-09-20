import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as BarLevel from 'resource:///org/gnome/shell/ui/barLevel.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {QuickMenuToggle, QuickToggle} from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {getDBus} from './dbus.js';

// ── Constants ──────────────────────────────────────────────────────────

const NoiseMode = Object.freeze({
    OFF: 1,
    ANC: 2,
    TRANSPARENCY: 3,
    ADAPTIVE: 4,
});

const NOISE_MODE_DEFS = [
    {mode: NoiseMode.OFF, label: 'Off'},
    {mode: NoiseMode.ANC, label: 'Noise Cancellation'},
    {mode: NoiseMode.TRANSPARENCY, label: 'Transparency'},
    {mode: NoiseMode.ADAPTIVE, label: 'Adaptive'},
];

function noiseModeLabel(mode) {
    return NOISE_MODE_DEFS.find(d => d.mode === mode)?.label ?? 'Unknown';
}

function batteryStatusLabel(status) {
    switch (status) {
        case 1: return 'Charging';
        case 2: return 'Not Charging';
        case 4: return 'Disconnected';
        default: return 'Unknown';
    }
}

function earStatusLabel(status) {
    switch (status) {
        case 0: return 'In Ear';
        case 1: return 'Out of Ear';
        case 2: return 'In Case';
        case 3: return 'Disconnected';
        default: return 'Unknown';
    }
}

function logDebugToFile(msg) {
    try {
        const timestamp = new Date().toISOString();
        const line = `[${timestamp}] ${msg}\n`;
        const path = '/home/krishhh16/.local/share/gnome-shell/extensions/librepods@krishhh.dev/extension_debug.log';
        const file = Gio.File.new_for_path(path);

        let content = '';
        if (file.query_exists(null)) {
            const [success, bytes] = file.load_contents(null);
            if (success) {
                content = new TextDecoder().decode(bytes);
            }
        }

        const lines = content.split('\n');
        if (lines[lines.length - 1] === '') lines.pop();
        lines.push(`[${timestamp}] ${msg}`);

        const MAX_LINES = 1000;
        const trimmedLines = lines.length > MAX_LINES ? lines.slice(lines.length - MAX_LINES) : lines;
        const finalContent = trimmedLines.join('\n') + '\n';

        file.replace_contents(finalContent, null, false, Gio.FileCreateFlags.NONE, null);
    } catch (e) {
        console.log(`[LibrePods] ${msg}`);
    }
}

function log(msg) {
    logDebugToFile(`[INFO] ${msg}`);
}

function logError(msg, error) {
    logDebugToFile(`[ERROR] ${msg}: ${error}`);
}

// ── State Management ───────────────────────────────────────────────────

const LibrePodsState = GObject.registerClass({
    Properties: {
        'connected': GObject.ParamSpec.boolean('connected', 'Connected', 'Connected status', GObject.ParamFlags.READABLE, false),
        'address': GObject.ParamSpec.string('address', 'Address', 'Device MAC Address', GObject.ParamFlags.READABLE, ''),
        'device-name': GObject.ParamSpec.string('device-name', 'DeviceName', 'Device Name', GObject.ParamFlags.READABLE, 'AirPods'),
        'battery-headphone': GObject.ParamSpec.uchar('battery-headphone', 'BatteryHeadphone', 'Battery Headphone', GObject.ParamFlags.READABLE, 0, 255, 255),
        'battery-headphone-status': GObject.ParamSpec.uchar('battery-headphone-status', 'BatteryHeadphoneStatus', 'Battery Headphone Status', GObject.ParamFlags.READABLE, 0, 255, 0),
        'battery-left': GObject.ParamSpec.uchar('battery-left', 'BatteryLeft', 'Battery Left', GObject.ParamFlags.READABLE, 0, 255, 255),
        'battery-left-status': GObject.ParamSpec.uchar('battery-left-status', 'BatteryLeftStatus', 'Battery Left Status', GObject.ParamFlags.READABLE, 0, 255, 0),
        'battery-right': GObject.ParamSpec.uchar('battery-right', 'BatteryRight', 'Battery Right', GObject.ParamFlags.READABLE, 0, 255, 255),
        'battery-right-status': GObject.ParamSpec.uchar('battery-right-status', 'BatteryRightStatus', 'Battery Right Status', GObject.ParamFlags.READABLE, 0, 255, 0),
        'battery-case': GObject.ParamSpec.uchar('battery-case', 'BatteryCase', 'Battery Case', GObject.ParamFlags.READABLE, 0, 255, 255),
        'battery-case-status': GObject.ParamSpec.uchar('battery-case-status', 'BatteryCaseStatus', 'Battery Case Status', GObject.ParamFlags.READABLE, 0, 255, 0),
        'listening-mode': GObject.ParamSpec.uchar('listening-mode', 'ListeningMode', 'Listening Mode', GObject.ParamFlags.READABLE, 0, 255, NoiseMode.OFF),
        'allow-off': GObject.ParamSpec.uchar('allow-off', 'AllowOff', 'Allow Off', GObject.ParamFlags.READABLE, 0, 255, 0),
        'conversation-detect': GObject.ParamSpec.boolean('conversation-detect', 'ConversationDetect', 'Conversation Detect', GObject.ParamFlags.READABLE, false),
        'personalized-volume': GObject.ParamSpec.boolean('personalized-volume', 'PersonalizedVolume', 'Personalized Volume', GObject.ParamFlags.READABLE, false),
        'ear-primary': GObject.ParamSpec.uchar('ear-primary', 'EarPrimary', 'Ear Primary', GObject.ParamFlags.READABLE, 0, 255, 255),
        'ear-secondary': GObject.ParamSpec.uchar('ear-secondary', 'EarSecondary', 'Ear Secondary', GObject.ParamFlags.READABLE, 0, 255, 255),
        'conversational-awareness': GObject.ParamSpec.uchar('conversational-awareness', 'ConversationalAwareness', 'Conversational Awareness', GObject.ParamFlags.READABLE, 0, 255, 0),
    },
}, class LibrePodsState extends GObject.Object {
    _init() {
        super._init();
        this._dbus = getDBus();
        this._connected = false;
        this._address = '';
        this._deviceName = 'AirPods';
        this._batteryHeadphone = 255;
        this._batteryHeadphoneStatus = 0;
        this._batteryLeft = 255;
        this._batteryLeftStatus = 0;
        this._batteryRight = 255;
        this._batteryRightStatus = 0;
        this._batteryCase = 255;
        this._batteryCaseStatus = 0;
        this._listeningMode = NoiseMode.OFF;
        this._allowOff = 0;
        this._conversationDetect = false;
        this._personalizedVolume = false;
        this._earPrimary = 255;
        this._earSecondary = 255;
        this._conversationalAwareness = 0;

        this._setupDBus();
        this._startPeriodicDump();
    }

    _startPeriodicDump() {
        this._dumpTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
            this.dumpStateTable();
            return GLib.SOURCE_CONTINUE;
        });
    }

    dumpStateTable() {
        logDebugToFile(`\n=== IN-MEMORY STATE TABLE DUMP ===\n` +
            `Connected: ${this._connected}\n` +
            `Address: "${this._address}"\n` +
            `DeviceName: "${this._deviceName}"\n` +
            `BatteryLeft: ${this._batteryLeft} (Status: ${this._batteryLeftStatus})\n` +
            `BatteryRight: ${this._batteryRight} (Status: ${this._batteryRightStatus})\n` +
            `BatteryCase: ${this._batteryCase} (Status: ${this._batteryCaseStatus})\n` +
            `BatteryHeadphone: ${this._batteryHeadphone}\n` +
            `ListeningMode: ${this._listeningMode}\n` +
            `AllowOff: ${this._allowOff}\n` +
            `ConversationDetect: ${this._conversationDetect}\n` +
            `PersonalizedVolume: ${this._personalizedVolume}\n` +
            `EarPrimary: ${this._earPrimary}, EarSecondary: ${this._earSecondary}\n` +
            `==================================`);
    }

    async refresh() {
        log('Manual refresh requested');
        await this._dbus.refresh();
    }

    _setupDBus() {
        this._dbus.ensureDBusConnected().catch(e => logError('Initial DBus connect failed:', e));

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
            this._dbus.onPropertyChanged(prop, (value) => this._onPropertyChanged(prop, value));
        }
    }

    _onPropertyChanged(prop, value) {
        const propMap = {
            'Connected': '_connected',
            'Address': '_address',
            'DeviceName': '_deviceName',
            'BatteryHeadphone': '_batteryHeadphone',
            'BatteryHeadphoneStatus': '_batteryHeadphoneStatus',
            'BatteryLeft': '_batteryLeft',
            'BatteryLeftStatus': '_batteryLeftStatus',
            'BatteryRight': '_batteryRight',
            'BatteryRightStatus': '_batteryRightStatus',
            'BatteryCase': '_batteryCase',
            'BatteryCaseStatus': '_batteryCaseStatus',
            'ListeningMode': '_listeningMode',
            'AllowOff': '_allowOff',
            'ConversationDetect': '_conversationDetect',
            'PersonalizedVolume': '_personalizedVolume',
            'EarPrimary': '_earPrimary',
            'EarSecondary': '_earSecondary',
            'ConversationalAwareness': '_conversationalAwareness',
        };

        const field = propMap[prop];
        if (field && this[field] !== value) {
            log(`[STATE CHANGE] ${prop}: ${this[field]} -> ${value}`);
            this[field] = value;
            const paramName = field.slice(1).replace(/([A-Z])/g, '-$1').toLowerCase();
            this.notify(paramName);
        }
    }

    // Getters
    get connected() { return this._connected; }
    get address() { return this._address; }
    get deviceName() { return this._deviceName; }
    get batteryHeadphone() { return this._batteryHeadphone; }
    get batteryHeadphoneStatus() { return this._batteryHeadphoneStatus; }
    get batteryLeft() { return this._batteryLeft; }
    get batteryLeftStatus() { return this._batteryLeftStatus; }
    get batteryRight() { return this._batteryRight; }
    get batteryRightStatus() { return this._batteryRightStatus; }
    get batteryCase() { return this._batteryCase; }
    get batteryCaseStatus() { return this._batteryCaseStatus; }
    get listeningMode() { return this._listeningMode; }
    get allowOff() { return this._allowOff; }
    get conversationDetect() { return this._conversationDetect; }
    get personalizedVolume() { return this._personalizedVolume; }
    get earPrimary() { return this._earPrimary; }
    get earSecondary() { return this._earSecondary; }
    get conversationalAwareness() { return this._conversationalAwareness; }

    // Actions
    async connect() {
        try {
            const devices = await this._dbus.callListDevices();
            if (devices.length === 0) {
                log('No AirPods devices found');
                return;
            }
            const target = devices.find(d => d[2]) || devices[0];
            await this._dbus.callConnectDevice(target[0]);
        } catch (e) {
            logError('Connect failed:', e);
        }
    }

    async disconnect() {
        if (!this._address) return;
        try {
            await this._dbus.callDisconnectDevice(this._address);
        } catch (e) {
            logError('Disconnect failed:', e);
        }
    }

    async setListeningMode(mode) {
        try {
            await this._dbus.callSetListeningMode(mode);
        } catch (e) {
            logError('SetListeningMode failed:', e);
        }
    }

    async setConversationDetect(enabled) {
        try {
            await this._dbus.callSetConversationDetect(enabled);
        } catch (e) {
            logError('SetConversationDetect failed:', e);
        }
    }

    async setPersonalizedVolume(enabled) {
        try {
            await this._dbus.callSetPersonalizedVolume(enabled);
        } catch (e) {
            logError('SetPersonalizedVolume failed:', e);
        }
    }

    async setAllowOff(enabled) {
        try {
            await this._dbus.callSetAllowOff(enabled);
        } catch (e) {
            logError('SetAllowOff failed:', e);
        }
    }

    destroy() {
        if (this._dumpTimerId) {
            GLib.source_remove(this._dumpTimerId);
            this._dumpTimerId = null;
        }
        this._dbus.destroy();
    }
});

// ── Hero Toggle ────────────────────────────────────────────────────────

const LibrePodsHeroToggle = GObject.registerClass(
class LibrePodsHeroToggle extends PopupMenu.PopupBaseMenuItem {
    _init(extensionDir, state) {
        super._init({reactive: true});
        this._state = state;
        this._updating = false;
        this.style_class = 'popup-menu-item librepods-hero';

        const iconPath = extensionDir
            .get_child('icons')
            .get_child('airpods-main.svg')
            .get_path();
        const icon = new St.Icon({
            gicon: Gio.Icon.new_for_string(iconPath),
            style_class: 'librepods-hero-icon',
        });
        this.add_child(icon);

        const textStack = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style: 'spacing: 1px; margin-left: 10px;',
        });

        this._titleLabel = new St.Label({
            text: 'AirPods',
            style_class: 'librepods-hero-title',
        });
        this._subtitleLabel = new St.Label({
            text: 'Disconnected',
            style_class: 'librepods-hero-subtitle',
        });

        textStack.add_child(this._titleLabel);
        textStack.add_child(this._subtitleLabel);
        this.add_child(textStack);

        this._switch = new PopupMenu.Switch(false);
        this._switch.add_style_class_name('librepods-hero-switch');
        this._switch.reactive = false;
        this.add_child(this._switch);

        this._connectionTimeoutId = null;

        this.connect('activate', () => {
            if (this._updating) return;
            const targetState = !this._switch.state;
            this._subtitleLabel.set_text(targetState ? 'Connecting...' : 'Disconnecting...');

            if (this._connectionTimeoutId) {
                GLib.source_remove(this._connectionTimeoutId);
                this._connectionTimeoutId = null;
            }

            this._connectionTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                this._connectionTimeoutId = null;
                this._updateFromState();
                return GLib.SOURCE_REMOVE;
            });

            if (targetState) {
                this._state.connect();
            } else {
                this._state.disconnect();
            }
        });

        this._state.connect('notify::connected', () => this._updateFromState());
        this._state.connect('notify::device-name', () => this._updateFromState());
        this._state.connect('notify::address', () => this._updateFromState());

        this._updateFromState();
    }

    _updateFromState() {
        if (this._connectionTimeoutId) {
            GLib.source_remove(this._connectionTimeoutId);
            this._connectionTimeoutId = null;
        }
        this._updating = true;
        try {
            const isConnected = !!this._state.connected;
            log(`[HERO UI UPDATE] Setting title: "${this._state.deviceName}", connected: ${isConnected}`);
            this._titleLabel.set_text(this._state.deviceName || 'AirPods');
            this._subtitleLabel.set_text(isConnected ? 'Connected' : 'Disconnected');
            this._switch.state = isConnected;
            this._syncCheckedStyle();
        } finally {
            this._updating = false;
        }
    }

    _syncCheckedStyle() {
        const isConnected = !!this._state.connected;
        if (isConnected) {
            this.add_style_pseudo_class('checked');
            this._switch.add_style_pseudo_class('checked');
        } else {
            this.remove_style_pseudo_class('checked');
            this._switch.remove_style_pseudo_class('checked');
        }
    }
});

// ── Noise Control Segmented Bar ────────────────────────────────────────

const NoiseModeBar = GObject.registerClass(
class NoiseModeBar extends St.BoxLayout {
    _init(state) {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });

        this._state = state;
        this._timeoutId = null;

        const header = new St.Label({
            text: 'NOISE CONTROLS',
            style_class: 'librepods-section-label librepods-noise-section-label',
        });
        this.add_child(header);

        this._tabBar = new St.BoxLayout({
            style_class: 'librepods-tab-bar librepods-noise-tab-bar',
            x_expand: true,
        });
        this.add_child(this._tabBar);

        this._buttons = new Map();
        for (const {mode, label} of NOISE_MODE_DEFS) {
            const btn = new St.Button({
                label,
                style_class: 'librepods-tab-button',
                can_focus: true,
                x_expand: true,
            });
            btn.connect('clicked', () => this._onTabClicked(mode));
            this._tabBar.add_child(btn);
            this._buttons.set(mode, btn);
        }

        this._state.connect('notify::listening-mode', () => this._updateFromState());
        this._state.connect('notify::connected', () => this._updateFromState());
        this._updateFromState();
    }

    _onTabClicked(mode) {
        log(`[NoiseModeBar] Tab clicked for mode ${mode}`);
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }

        // Optimistically highlight the clicked tab immediately
        for (const [m, btn] of this._buttons) {
            if (m === mode)
                btn.add_style_pseudo_class('selected');
            else
                btn.remove_style_pseudo_class('selected');
        }

        // Send D-Bus set command
        this._state.setListeningMode(mode);

        // 2-second fallback timeout: if backend doesn't confirm within 2s, revert back to state
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            log(`[NoiseModeBar] 2s timeout reached without backend confirmation; reverting UI state`);
            this._timeoutId = null;
            this._updateFromState();
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateFromState() {
        if (this._timeoutId) {
            log(`[NoiseModeBar] Backend state update received before timeout expired`);
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }

        const activeMode = this._state.listeningMode || NoiseMode.OFF;
        for (const [m, btn] of this._buttons) {
            if (m === activeMode)
                btn.add_style_pseudo_class('selected');
            else
                btn.remove_style_pseudo_class('selected');
        }
    }

    destroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        super.destroy();
    }
});

// ── Conversation Detect Toggle ────────────────────────────────────────

const ConversationDetectToggle = GObject.registerClass(
class ConversationDetectToggle extends QuickToggle {
    _init(state) {
        super._init({
            title: 'Conversation',
            subtitle: 'Off',
            icon_name: 'audio-input-microphone-symbolic',
            toggle_mode: true,
            checked: false,
            x_expand: true,
        });
        this._state = state;
        this._updating = false;

        this.connect('clicked', () => {
            if (this._updating) return;
            this._state.setConversationDetect(this.checked);
        });

        this._state.connect('notify::conversation-detect', () => this._updateFromState());
        this._state.connect('notify::connected', () => this._updateFromState());
        this._updateFromState();
    }

    _updateFromState() {
        this._updating = true;
        this.checked = this._state.conversationDetect;
        this.subtitle = this.checked ? 'On' : 'Off';
        this._updating = false;
    }
});

// ── Personalized Volume Toggle ────────────────────────────────────────

const PersonalizedVolumeToggle = GObject.registerClass(
class PersonalizedVolumeToggle extends QuickToggle {
    _init(state) {
        super._init({
            title: 'Personalized Volume',
            subtitle: 'Off',
            icon_name: 'audio-volume-high-symbolic',
            toggle_mode: true,
            checked: false,
            x_expand: true,
        });
        this._state = state;
        this._updating = false;

        this.connect('clicked', () => {
            if (this._updating) return;
            this._state.setPersonalizedVolume(this.checked);
        });

        this._state.connect('notify::personalized-volume', () => this._updateFromState());
        this._state.connect('notify::connected', () => this._updateFromState());
        this._updateFromState();
    }

    _updateFromState() {
        this._updating = true;
        this.checked = this._state.personalizedVolume;
        this.subtitle = this.checked ? 'On' : 'Off';
        this._updating = false;
    }
});

// ── Allow Off Toggle (for Advanced page) ──────────────────────────────

const AllowOffToggle = GObject.registerClass(
class AllowOffToggle extends PopupMenu.PopupSwitchMenuItem {
    _init(state) {
        super._init('Off Listening Mode', false);
        this._state = state;
        this._updating = false;
        this.style_class = 'popup-menu-item librepods-setting-item';
        this._switch.reactive = true;

        this.connect('activate', () => {
            if (this._updating) return;
            this._state.setAllowOff(this._switch.state);
        });

        this._switch.connect('notify::state', () => this._syncCheckedStyle());
        this._state.connect('notify::allow-off', () => this._updateFromState());
        this._state.connect('notify::connected', () => this._updateFromState());

        this._syncCheckedStyle();
        this._updateFromState();
    }

    _updateFromState() {
        this._updating = true;
        this._switch.state = this._state.allowOff === 1;
        this._updating = false;
    }

    _syncCheckedStyle() {
        if (this._switch.state)
            this.add_style_pseudo_class('checked');
        else
            this.remove_style_pseudo_class('checked');
    }
});

// ── Battery Row ────────────────────────────────────────────────────────

const BatteryRow = GObject.registerClass(
class BatteryRow extends St.BoxLayout {
    _init(name, state, batteryType) {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'librepods-battery-card',
            x_expand: true,
        });
        this._state = state;
        this._batteryType = batteryType;

        this._bar = new BarLevel.BarLevel({
            value: 0,
            maximum_value: 1.0,
            x_expand: true,
            style_class: 'librepods-battery-bar',
        });

        const bottomRow = new St.BoxLayout({x_expand: true});
        this._nameLabel = new St.Label({
            text: name,
            style_class: 'librepods-battery-name',
            x_expand: true,
        });
        this._pctLabel = new St.Label({
            text: '—',
            style_class: 'librepods-battery-pct',
        });
        bottomRow.add_child(this._nameLabel);
        bottomRow.add_child(this._pctLabel);

        this.add_child(this._bar);
        this.add_child(bottomRow);

        const [levelGetter, statusGetter] = this._getGettersForType(batteryType);
        this._state.connect(`notify::${levelGetter.replace(/([A-Z])/g, '-$1').toLowerCase()}`, () => this._updateFromState());
        this._state.connect(`notify::${statusGetter.replace(/([A-Z])/g, '-$1').toLowerCase()}`, () => this._updateFromState());
        this._state.connect('notify::connected', () => this._updateFromState());
        this._updateFromState();
    }

    _getGettersForType(type) {
        switch (type) {
            case 'left': return ['batteryLeft', 'batteryLeftStatus'];
            case 'right': return ['batteryRight', 'batteryRightStatus'];
            case 'case': return ['batteryCase', 'batteryCaseStatus'];
            default: return ['batteryHeadphone', 'batteryHeadphoneStatus'];
        }
    }

    _updateFromState() {
        const [levelGetter, statusGetter] = this._getGettersForType(this._batteryType);
        const level = this._state[levelGetter];
        const status = this._state[statusGetter];

        log(`[BATTERY ROW UPDATE] type: ${this._batteryType}, level: ${level}, status: ${status}`);

        if (level === 255 || status === 4) {
            this._bar.value = 0;
            this._pctLabel.set_text('—');
            this._pctLabel.remove_style_class_name('librepods-battery-has-info');
            this._nameLabel.remove_style_class_name('librepods-battery-has-info');
        } else {
            const normalized = Math.max(0, Math.min(1.0, level / 100.0));
            this._bar.value = normalized;
            this._pctLabel.set_text(`${level}%`);
            this._pctLabel.add_style_class_name('librepods-battery-has-info');
            this._nameLabel.add_style_class_name('librepods-battery-has-info');
        }
    }
});

// ── Info Row ──────────────────────────────────────────────────────────

const InfoRow = GObject.registerClass(
class InfoRow extends PopupMenu.PopupMenuItem {
    _init(key, state, getterName, formatter) {
        super._init(key, {reactive: false, can_focus: false});
        this._state = state;
        this._getterName = getterName;
        this._formatter = formatter;
        this.style_class = 'popup-menu-item librepods-info-item';

        this._valueLabel = new St.Label({
            text: '—',
            style_class: 'popup-status-menu-item',
        });
        this.add_child(this._valueLabel);

        const signalName = getterName.replace(/([A-Z])/g, '-$1').toLowerCase();
        this._state.connect(`notify::${signalName}`, () => this._updateFromState());
        this._state.connect('notify::connected', () => this._updateFromState());
        this._updateFromState();
    }

    _updateFromState() {
        const value = this._state[this._getterName];
        const formatted = this._formatter ? this._formatter(value) : (value ?? '—');
        this._valueLabel.set_text(formatted);
    }
});

// ── Notebook Tab Bar ──────────────────────────────────────────────────

const Notebook = GObject.registerClass(
class Notebook extends St.BoxLayout {
    _init() {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });

        this._tabBar = new St.BoxLayout({
            style_class: 'librepods-tab-bar',
            x_expand: true,
        });
        this.add_child(this._tabBar);

        this._pageContainer = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        this.add_child(this._pageContainer);

        this._tabs = [];
        this._selectedIndex = -1;
    }

    appendPage(name, child) {
        const index = this._tabs.length;
        const tabBtn = new St.Button({
            label: name,
            style_class: 'librepods-tab-button',
            can_focus: true,
            x_expand: true,
        });

        tabBtn.connect('clicked', () => this.selectIndex(index));

        this._tabBar.add_child(tabBtn);

        child.visible = false;
        this._pageContainer.add_child(child);

        this._tabs.push({tabBtn, child});

        if (this._selectedIndex === -1)
            this.selectIndex(0);
    }

    selectIndex(index) {
        if (index < 0 || index >= this._tabs.length)
            return;
        if (index === this._selectedIndex)
            return;

        if (this._selectedIndex >= 0) {
            const prev = this._tabs[this._selectedIndex];
            prev.tabBtn.remove_style_pseudo_class('selected');
            prev.child.visible = false;
        }

        const next = this._tabs[index];
        next.tabBtn.add_style_pseudo_class('selected');
        next.child.visible = true;
        this._selectedIndex = index;
    }

    get selectedIndex() {
        return this._selectedIndex;
    }
});

function _buildControlsPage(state) {
    const page = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'librepods-tab-page',
        x_expand: true,
    });

    const batteryBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'librepods-battery-box',
        x_expand: true,
    });

    const batteryHeader = new St.Label({
        text: 'BATTERY',
        style_class: 'librepods-section-label librepods-battery-section-label',
    });
    batteryBox.add_child(batteryHeader);

    const leftRow = new BatteryRow('Left AirPod', state, 'left');
    const rightRow = new BatteryRow('Right AirPod', state, 'right');
    const caseRow = new BatteryRow('Case', state, 'case');

    batteryBox.add_child(leftRow);
    batteryBox.add_child(rightRow);
    batteryBox.add_child(caseRow);

    page.add_child(batteryBox);

    const noiseModeBar = new NoiseModeBar(state);
    page.add_child(noiseModeBar);

    return {page, noiseModeBar, leftRow, rightRow, caseRow};
}

function _buildAdvancedPage(state) {
    const page = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'librepods-tab-page librepods-tab-page-tight',
        x_expand: true,
    });

    const sections = [
        {
            title: 'INTELLIGENT AUDIO',
            items: [
                {id: 'pers_vol', label: 'Personalized Volume', toggle: null},
                {id: 'conv_aware', label: 'Conversational Awareness', toggle: null},
            ],
        },
        {
            title: 'HARDWARE & CONTROLS',
            items: [
                {id: 'off_mode', label: 'Off Listening Mode', toggle: AllowOffToggle},
            ],
        },
    ];

    for (const section of sections) {
        const header = new St.Label({
            text: section.title,
            style_class: 'librepods-section-label',
        });
        page.add_child(header);

        for (const item of section.items) {
            if (item.toggle) {
                const toggle = new item.toggle(state);
                item.toggle = toggle;
                page.add_child(toggle);
            } else {
                const menuItem = new PopupMenu.PopupSwitchMenuItem(item.label, false);
                menuItem._switch.reactive = false;
                menuItem.style_class = 'popup-menu-item librepods-setting-item';
                item.menuItem = menuItem;
                page.add_child(menuItem);
            }
        }
    }

    return page;
}

function _buildInfoPage(state) {
    const page = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'librepods-tab-page librepods-tab-page-tight',
        x_expand: true,
    });

    const header = new St.Label({
        text: 'DEVICE INFO',
        style_class: 'librepods-section-label',
    });
    page.add_child(header);

    const infoDefs = [
        {key: 'Name', getter: 'deviceName', formatter: v => v || '—'},
        {key: 'Address', getter: 'address', formatter: v => v || '—'},
        {key: 'Listening Mode', getter: 'listeningMode', formatter: v => noiseModeLabel(v)},
        {key: 'Ear Detection', getter: 'earPrimary', formatter: v => earStatusLabel(v)},
    ];

    const infoRows = [];
    for (const {key, getter, formatter} of infoDefs) {
        const item = new InfoRow(key, state, getter, formatter);
        page.add_child(item);
        infoRows.push(item);
    }

    return {page, infoRows};
}

// ── Main Indicator ────────────────────────────────────────────────────

export const LibrePodsIndicator = GObject.registerClass(
class LibrePodsIndicator extends PanelMenu.Button {
    _init(extensionDir) {
        super._init(0.0, 'LibrePods', true);

        this._extensionDir = extensionDir;
        this._state = new LibrePodsState();

        // Panel icon
        const iconPath = extensionDir
            .get_child('icons')
            .get_child('airpods-main.svg')
            .get_path();
        this._panelIcon = new St.Icon({
            gicon: Gio.Icon.new_for_string(iconPath),
            style_class: 'system-status-icon',
        });
        this.add_child(this._panelIcon);

        this._panelIcon.add_style_class_name('librepods-disconnected');

        // Menu
        this._menu = new PopupMenu.PopupMenu(this, 0.0, St.Side.TOP);
        this._menu.box.add_style_class_name('librepods-menu-box');

        this._wrapperItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        this._wrapperItem.add_style_class_name('librepods-wrapper-item');

        this._contentBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'librepods-container',
            x_expand: true,
        });

        // Hero toggle
        this._heroToggle = new LibrePodsHeroToggle(extensionDir, this._state);
        this._contentBox.add_child(this._heroToggle);

        // Build tab pages
        const controls = _buildControlsPage(this._state);
        const controlsPage = controls.page;
        this._batteryRows = {
            leftRow: controls.leftRow,
            rightRow: controls.rightRow,
            caseRow: controls.caseRow,
        };
        const advancedPage = _buildAdvancedPage(this._state);
        const {page: infoPage, infoRows} = _buildInfoPage(this._state);
        this._infoRows = infoRows;

        // Tabbed notebook
        this._notebook = new Notebook();
        this._notebook.appendPage('Controls', controlsPage);
        this._notebook.appendPage('Advanced', advancedPage);
        this._notebook.appendPage('System', infoPage);

        this._contentBox.add_child(this._notebook);

        this._wrapperItem.add_child(this._contentBox);
        this._menu.addMenuItem(this._wrapperItem);

        this.setMenu(this._menu);

        // Sync state when menu opens
        this._menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                this._state.refresh().then(() => {
                    this._heroToggle._updateFromState();
                    if (this._batteryRows) {
                        this._batteryRows.leftRow._updateFromState();
                        this._batteryRows.rightRow._updateFromState();
                        this._batteryRows.caseRow._updateFromState();
                    }
                    if (controls.noiseModeBar) {
                        controls.noiseModeBar._updateFromState();
                    }
                    if (this._infoRows) {
                        this._infoRows.forEach(row => row._updateFromState());
                    }
                    this._updatePanelIcon();
                }).catch(() => {});
            }
        });

        // Sync panel icon
        this._state.connect('notify::connected', () => this._updatePanelIcon());
        this._updatePanelIcon();
    }

    _updatePanelIcon() {
        if (this._state.connected)
            this._panelIcon.remove_style_class_name('librepods-disconnected');
        else
            this._panelIcon.add_style_class_name('librepods-disconnected');
    }

    destroy() {
        this._state.destroy();
        super.destroy();
    }
});