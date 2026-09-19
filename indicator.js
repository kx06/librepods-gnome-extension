import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as BarLevel from 'resource:///org/gnome/shell/ui/barLevel.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {QuickMenuToggle, QuickToggle} from 'resource:///org/gnome/shell/ui/quickSettings.js';

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

// ── Hero Toggle ────────────────────────────────────────────────────────

const LibrePodsHeroToggle = GObject.registerClass(
class LibrePodsHeroToggle extends PopupMenu.PopupBaseMenuItem {
    _init(extensionDir) {
        super._init({reactive: true});
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

        this.connect('activate', () => {
            this._switch.toggle();
        });
    }

    setStatus(connected, deviceName) {
        this._titleLabel.set_text(deviceName || 'AirPods');
        this._subtitleLabel.set_text(connected ? 'Connected' : 'Disconnected');
    }
});

// ── Noise Control Toggle ───────────────────────────────────────────────

const NoiseControlToggle = GObject.registerClass(
class NoiseControlToggle extends QuickMenuToggle {
    _init() {
        super._init({
            title: 'Noise Control',
            subtitle: 'Off',
            icon_name: 'audio-headphones-symbolic',
            toggle_mode: true,
            checked: false,
            menu_enabled: true,
            x_expand: true,
        });

        this._mode = NoiseMode.OFF;

        this.menu.setHeader('audio-headphones-symbolic', 'Noise Control');

        this._modeItems = new Map();
        for (const {mode, label} of NOISE_MODE_DEFS) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => this._setMode(mode));
            this.menu.addMenuItem(item);
            this._modeItems.set(mode, item);
        }

        this.connect('clicked', () => {
            const newMode = this.checked ? this._mode : NoiseMode.OFF;
            this._setMode(newMode);
        });
    }

    _setMode(mode) {
        this._mode = mode;
        this.checked = mode !== NoiseMode.OFF;
        this.subtitle = noiseModeLabel(mode);

        for (const [m, item] of this._modeItems) {
            item.setOrnament(m === mode
                ? PopupMenu.Ornament.CHECK
                : PopupMenu.Ornament.NONE);
        }

        this.menu.close();
    }

    getMode() {
        return this._mode;
    }
});

// ── Simple Toggles ─────────────────────────────────────────────────────

const ConversationDetectToggle = GObject.registerClass(
class ConversationDetectToggle extends QuickToggle {
    _init() {
        super._init({
            title: 'Conversation',
            subtitle: 'Off',
            icon_name: 'audio-input-microphone-symbolic',
            toggle_mode: true,
            checked: false,
            x_expand: true,
        });
        this.connect('clicked', () => {
            this.subtitle = this.checked ? 'On' : 'Off';
        });
    }
});

const PersonalizedVolumeToggle = GObject.registerClass(
class PersonalizedVolumeToggle extends QuickToggle {
    _init() {
        super._init({
            title: 'Personalized Volume',
            subtitle: 'Off',
            icon_name: 'audio-volume-high-symbolic',
            toggle_mode: true,
            checked: false,
            x_expand: true,
        });
        this.connect('clicked', () => {
            this.subtitle = this.checked ? 'On' : 'Off';
        });
    }
});

// ── Notebook Tab Bar ───────────────────────────────────────────────────

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

// ── Tab Page Builders ──────────────────────────────────────────────────

function _buildControlsPage(noiseControl, conversationDetect, personalizedVolume) {
    const page = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'librepods-tab-page',
        x_expand: true,
    });

    page.add_child(noiseControl);

    const row = new St.BoxLayout({
        style_class: 'librepods-toggle-row',
        x_expand: true,
        homogeneous: true,
    });
    row.add_child(conversationDetect);
    row.add_child(personalizedVolume);
    page.add_child(row);

    return page;
}

function _buildBatteryPage() {
    const page = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'librepods-tab-page',
        x_expand: true,
    });

    const devices = [
        {name: 'Left AirPod'},
        {name: 'Right AirPod'},
        {name: 'Case'},
    ];

    page._rows = {};
    for (const {name} of devices) {
        const card = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'librepods-battery-card',
            x_expand: true,
        });

        const bar = new BarLevel.BarLevel({
            value: 0,
            maximum_value: 1,
            x_expand: true,
            style_class: 'librepods-battery-bar',
        });

        const bottomRow = new St.BoxLayout({
            x_expand: true,
        });
        const nameLabel = new St.Label({
            text: name,
            style_class: 'librepods-battery-name',
            x_expand: true,
        });
        const pctLabel = new St.Label({
            text: '—',
            style_class: 'librepods-battery-pct',
        });
        bottomRow.add_child(nameLabel);
        bottomRow.add_child(pctLabel);

        card.add_child(bar);
        card.add_child(bottomRow);

        page._rows[name] = {bar, pctLabel};
        page.add_child(card);
    }

    return page;
}

function _buildAdvancedPage() {
    const page = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'librepods-tab-page',
        x_expand: true,
    });

    const sections = [
        {
            title: 'INTELLIGENT AUDIO',
            items: [
                {id: 'pers_vol', label: 'Personalized Volume'},
                {id: 'conv_aware', label: 'Conversational Awareness'},
                {id: 'loud_red', label: 'Loud Sound Reduction'},
            ],
        },
        {
            title: 'HARDWARE & CONTROLS',
            items: [
                {id: 'off_mode', label: 'Off Listening Mode'},
                {id: 'hires_mic', label: 'Hi-Res Studio Mic'},
            ],
        },
    ];

    page._settingCards = [];
    for (const section of sections) {
        const header = new St.Label({
            text: section.title,
            style_class: 'librepods-section-label',
        });
        page.add_child(header);

        for (const item of section.items) {
            const menuItem = new PopupMenu.PopupSwitchMenuItem(item.label, false);
            menuItem._switch.reactive = false;
            menuItem.style_class = 'popup-menu-item librepods-setting-item';

            page._settingCards.push({id: item.id, menuItem});
            page.add_child(menuItem);
        }
    }

    return page;
}

function _buildInfoPage() {
    const page = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'librepods-tab-page',
        x_expand: true,
    });

    const header = new St.Label({
        text: 'DEVICE INFO',
        style_class: 'librepods-section-label',
    });
    page.add_child(header);

    const infoRows = [
        {key: 'Name', id: 'name'},
        {key: 'Address', id: 'address'},
        {key: 'Listening Mode', id: 'listening'},
        {key: 'Ear Detection', id: 'ear'},
    ];

    page._infoValues = {};
    for (const {key, id} of infoRows) {
        const item = new PopupMenu.PopupSwitchMenuItem(key, false);
        item.setStatus('—');
        item.style_class = 'popup-menu-item librepods-info-item';
        item.reactive = false;

        page._infoValues[id] = item;
        page.add_child(item);
    }

    return page;
}

// ── Main Indicator ─────────────────────────────────────────────────────

export const LibrePodsIndicator = GObject.registerClass(
class LibrePodsIndicator extends PanelMenu.Button {
    _init(extensionDir) {
        super._init(0.0, 'LibrePods', true);

        this._extensionDir = extensionDir;

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

        // ── Menu ──
        this._menu = new PopupMenu.PopupMenu(this, 0.0, St.Side.TOP);
        this._menu.box.add_style_class_name('librepods-menu-box');

        // Single wrapper item that holds all custom UI
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
        this._heroToggle = new LibrePodsHeroToggle(extensionDir);
        this._contentBox.add_child(this._heroToggle);

        // Controls tab widgets
        this._noiseControl = new NoiseControlToggle();
        this._conversationDetect = new ConversationDetectToggle();
        this._personalizedVolume = new PersonalizedVolumeToggle();

        // Tabbed notebook
        this._notebook = new Notebook();

        const controlsPage = _buildControlsPage(
            this._noiseControl,
            this._conversationDetect,
            this._personalizedVolume,
        );
        this._notebook.appendPage('Controls', controlsPage);

        this._batteryPage = _buildBatteryPage();
        this._notebook.appendPage('Charge', this._batteryPage);

        const advancedPage = _buildAdvancedPage();
        this._notebook.appendPage('Advanced', advancedPage);

        const infoPage = _buildInfoPage();
        this._notebook.appendPage('System', infoPage);

        this._contentBox.add_child(this._notebook);

        this._wrapperItem.add_child(this._contentBox);
        this._menu.addMenuItem(this._wrapperItem);

        this.setMenu(this._menu);
    }

    setConnected(connected) {
        if (connected)
            this._panelIcon.remove_style_class_name('librepods-disconnected');
        else
            this._panelIcon.add_style_class_name('librepods-disconnected');

        this._heroToggle.setStatus(connected);
    }
});
