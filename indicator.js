import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
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

// ── State Management ───────────────────────────────────────────────────

const LibrePodsState = GObject.registerClass(
class LibrePodsState extends GObject.Object {
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
    }

    _setupDBus() {
        this._dbus.connect().catch(e => logError('Initial DBus connect failed:', e));

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
            this[field] = value;
            this.notify(field.slice(1).replace(/([A-Z])/g, '-$1').toLowerCase());
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
        this._dbus.destroy();
    }
});

// ── Hero Toggle ────────────────────────────────────────────────────────

const LibrePodsHeroToggle = GObject.registerClass(
class LibrePodsHeroToggle extends PopupMenu.PopupBaseMenuItem {
    _init(extensionDir, state) {
        super._init({reactive: true});
        this._state = state;
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
        this.add_child(this._switch);

        this._switch.connect('notify::state', () => this._onSwitchToggled());
        this.connect('activate', () => this._switch.toggle());

        this._state.connect('notify::connected', () => this._updateFromState());
        this._state.connect('notify::device-name', () => this._updateFromState());
        this._state.connect('notify::address', () => this._updateFromState());

        this._updateFromState();
    }

    _updateFromState() {
        this._titleLabel.set_text(this._state.deviceName || 'AirPods');
        this._subtitleLabel.set_text(this._state.connected ? 'Connected' : 'Disconnected');
        this._switch.state = this._state.connected;
        this._syncCheckedStyle();
    }

    _onSwitchToggled() {
        if (this._switch.state) {
            this._state.connect();
        } else {
            this._state.disconnect();
        }
        this._syncCheckedStyle();
    }

    _syncCheckedStyle() {
        if (this._switch.state)
            this.add_style_pseudo_class('checked');
        else
            this.remove_style_pseudo_class('checked');
    }
});

// ── Noise Control ────────────────────────────────────────────────────

const NoiseControlToggle = GObject.registerClass(
class NoiseControlToggle extends QuickMenuToggle {
    _init(state) {
        super._init({
            title: 'Noise Control',
            subtitle: 'Off',
            icon_name: 'audio-headphones-symbolic',
            toggle_mode: true,
            checked: false,
            menu_enabled: true,
            x_expand: true,
        });

        this._state = state;
        this._mode = NoiseMode.OFF;
        this._updating = false;

        this._modeItems = new Map();
        for (const {mode, label} of NOISE_MODE_DEFS) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => this._setMode(mode));
            this.menu.addMenuItem(item);
            this._modeItems.set(mode, item);
        }

        this.connect('clicked', () => {
            if (this._updating) return;
            const newMode = this.checked ? this._mode : NoiseMode.OFF;
            this._setMode(newMode);
        });

        this._state.connect('notify::listening-mode', () => this._updateFromState());
        this._state.connect('notify::connected', () => this._updateFromState());
        this._updateFromState();
    }

    _updateFromState() {
        this._updating = true;
        this._mode = this._state.listeningMode || NoiseMode.OFF;
        this.checked = this._mode !== NoiseMode.OFF;
        this.subtitle = noiseModeLabel(this._mode);

        for (const [m, item] of this._modeItems) {
            item.setOrnament(m === this._mode
                ? PopupMenu.Ornament.CHECK
                : PopupMenu.Ornament.NONE);
        }
        this._updating = false;
    }

    _setMode(mode) {
        if (this._updating) return;
        this._mode = mode;
        this.checked = mode !== NoiseMode.OFF;
        this.subtitle = noiseModeLabel(mode);

        for (const [m, item] of this._modeItems) {
            item.setOrnament(m === mode
                ? PopupMenu.Ornament.CHECK
                : PopupMenu.Ornament.NONE);
        }

        this.menu.close();
        this._state.setListeningMode(mode);
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
            maximum_value: 100,
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

        if (level === 255 || status === 4) {
            this._bar.value = 0;
            this._pctLabel.set_text('—');
        } else {
            this._bar.value = level;
            this._pctLabel.set_text(`${level}%`);
        }
    }
});

// ── Info Row ──────────────────────────────────────────────────────────

const InfoRow = GObject.registerClass(
class InfoRow extends PopupMenu.PopupSwitchMenuItem {
    _init(key, state, getterName, formatter) {
        super._init(key, false);
        this._state = state;
        this._getterName = getterName;
        this._formatter = formatter;
        this.style_class = 'popup-menu-item librepods-info-item';
        this.reactive = false;
        this._switch.reactive = false;

        const signalName = getterName.replace(/([A-Z])/g, '-$1').toLowerCase();
        this._state.connect(`notify::${signalName}`, () => this._updateFromState());
        this._state.connect('notify::connected', () => this._updateFromState());
        this._updateFromState();
    }

    _updateFromState() {
        const value = this._state[this._getterName];
        this.setStatus(this._formatter ? this._formatter(value) : (value ?? '—'));
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

        const container = this._pageContainer;
        const currentHeight = container.height >= 0 ? container.height : container.get_preferred_height(-1)[1];
        const [, targetHeight] = next.child.get_preferred_height(-1);

        container.height = currentHeight;
        container.ease({
            height: targetHeight,
            duration: 250,
            mode: Clutter.AnimationMode.EASE_OUT_EXPO,
            onComplete: () => container.set_height(-1),
        });
    }

    get selectedIndex() {
        return this._selectedIndex;
    }
});

// ── Tab Page Builders ──────────────────────────────────────────────────

function _buildControlsPage(state) {
    const page = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'librepods-tab-page',
        x_expand: true,
    });

    const noiseControl = new NoiseControlToggle(state);
    const conversationDetect = new ConversationDetectToggle(state);
    const personalizedVolume = new PersonalizedVolumeToggle(state);

    page.add_child(noiseControl);
    noiseControl.menu.actor.hide();
    page.add_child(noiseControl.menu.actor);

    const row = new St.BoxLayout({
        style_class: 'librepods-toggle-row',
        x_expand: true,
    });
    row.add_child(conversationDetect);
    row.add_child(personalizedVolume);
    page.add_child(row);

    return {page, noiseControl, conversationDetect, personalizedVolume};
}

function _buildBatteryPage(state) {
    const page = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'librepods-tab-page',
        x_expand: true,
    });

    const leftRow = new BatteryRow('Left AirPod', state, 'left');
    const rightRow = new BatteryRow('Right AirPod', state, 'right');
    const caseRow = new BatteryRow('Case', state, 'case');

    page.add_child(leftRow);
    page.add_child(rightRow);
    page.add_child(caseRow);

    return {page, leftRow, rightRow, caseRow};
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

    const infoRows = [
        {key: 'Name', getter: 'deviceName', formatter: v => v || '—'},
        {key: 'Address', getter: 'address', formatter: v => v || '—'},
        {key: 'Listening Mode', getter: 'listeningMode', formatter: v => noiseModeLabel(v)},
        {key: 'Ear Detection', getter: 'earPrimary', formatter: v => earStatusLabel(v)},
    ];

    for (const {key, getter, formatter} of infoRows) {
        const item = new InfoRow(key, state, getter, formatter);
        page.add_child(item);
    }

    return page;
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
        const {page: controlsPage} = _buildControlsPage(this._state);
        this._batteryPage = _buildBatteryPage(this._state).page;
        const advancedPage = _buildAdvancedPage(this._state);
        const infoPage = _buildInfoPage(this._state);

        // Tabbed notebook
        this._notebook = new Notebook();
        this._notebook.appendPage('Controls', controlsPage);
        this._notebook.appendPage('Charge', this._batteryPage);
        this._notebook.appendPage('Advanced', advancedPage);
        this._notebook.appendPage('System', infoPage);

        this._contentBox.add_child(this._notebook);

        this._wrapperItem.add_child(this._contentBox);
        this._menu.addMenuItem(this._wrapperItem);

        this.setMenu(this._menu);

        // Sync panel icon
        this._state.connect('notify::connected', () => this._updatePanelIcon());
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

function log(msg) {
    console.log(`[LibrePods] ${msg}`);
}

function logError(msg, error) {
    console.error(`[LibrePods] ${msg}`, error);
}