import St from "gi://St";
import Clutter from "gi://Clutter";
import Pango from "gi://Pango";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import Gio from "gi://Gio";

// Log function — used for debugging D‑Bus failures in the extension.
log = (msg) => {
  console.error(msg);
};

// org.librepods.Service ListeningMode wire values — this is our canonical enum.
const NoiseMode = Object.freeze({
  OFF: 1,
  ANC: 2,
  TRANSPARENCY: 3,
  ADAPTIVE: 4,
});

function dbusUnpack(value) {
  if (value === undefined || value === null) return value;
  if (typeof value.deep_unpack === "function")
    return dbusUnpack(value.deep_unpack());
  return value;
}

function normalizeNoiseMode(value) {
  const mode = Number(dbusUnpack(value));
  if (
    mode === NoiseMode.OFF ||
    mode === NoiseMode.ANC ||
    mode === NoiseMode.TRANSPARENCY ||
    mode === NoiseMode.ADAPTIVE
  )
    return mode;
  return NoiseMode.ANC;
}

function batteryPct(value) {
  const n = Number(dbusUnpack(value));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n);
}

function batteryStatusLabel(status) {
  switch (Number(dbusUnpack(status))) {
    case 1:
      return "Charging";
    case 2:
      return "Not charging";
    case 4:
      return "Case not reporting (last known)";
    default:
      return "Unknown";
  }
}

function earStatusLabel(value) {
  switch (Number(dbusUnpack(value))) {
    case 0:
      return "In ear";
    case 1:
      return "Out of ear";
    case 2:
      return "In case";
    case 3:
      return "Disconnected";
    default:
      return "Unknown";
  }
}

function listeningModeLabel(value) {
  switch (normalizeNoiseMode(value)) {
    case NoiseMode.OFF:
      return "Off";
    case NoiseMode.ANC:
      return "Noise Cancellation";
    case NoiseMode.TRANSPARENCY:
      return "Transparency";
    case NoiseMode.ADAPTIVE:
      return "Adaptive";
    default:
      return "Unknown";
  }
}

// Helper: create a homogeneous horizontal layout using St.Widget + Clutter.BoxLayout
// This is required because St.BoxLayout does not support homogeneous in its constructor
// args in GNOME Shell 48+.
function makeHomogeneousHBox(styleClass, spacing = 8) {
  let widget = new St.Widget({
    style_class: styleClass,
    layout_manager: new Clutter.BoxLayout({ homogeneous: true, spacing }),
    x_expand: true,
  });
  return widget;
}

export default class LibrePodsExtension extends Extension {
  enable() {
    // Top bar indicator button
    this._indicator = new PanelMenu.Button(0.0, "LibrePods Indicator", false);

    // Custom Icon Path
    const iconPath = this.dir
      .get_child("icons")
      .get_child("airpods-main.svg")
      .get_path();
    const gicon = Gio.Icon.new_for_string(iconPath);

    this._icon = new St.Icon({
      gicon: gicon,
      style_class: "system-status-icon",
    });

    this._indicator.add_child(this._icon);

    // State variables
    this._isConnected = false;
    this._deviceName = "";
    this._activeTab = "controls";
    this._noiseMode = NoiseMode.ANC;
    this._quickPills = {};
    this._settingById = {};
    this._infoValues = {};

    // Build main popover
    this._buildPopoverContent();

    if (this._indicator.menu && this._indicator.menu.actor) {
      this._indicator.menu.actor.add_style_class_name(
        "librepods-custom-popover",
      );
    }
    Main.panel.addToStatusArea("librepods-indicator", this._indicator);
  }

  disable() {
    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }
  }

  _buildPopoverContent() {
    this._pills = [];

    this._mainBox = new St.BoxLayout({
      vertical: true,
      style_class: "librepods-adwaita-container",
      x_expand: true,
    });

    // 1. MASTER HERO ITEM (Native hover button with toggle switch)
    let heroCard = new St.Button({
      style_class: "popup-menu-item librepods-hero-item",
      can_focus: true,
      x_expand: true,
    });

    let heroBox = new St.BoxLayout({
      vertical: false,
      style_class: "librepods-adwaita-hero-box",
      x_expand: true,
    });

    let heroIconPath = this.dir
      .get_child("icons")
      .get_child("airpods-main.svg")
      .get_path();
    let heroIcon = new St.Icon({
      gicon: Gio.Icon.new_for_string(heroIconPath),
      style_class: "popup-menu-icon librepods-hero-icon",
    });

    let metaBox = new St.BoxLayout({
      vertical: true,
      style_class: "librepods-hero-text-box",
      x_expand: true,
    });

    let titleLabel = new St.Label({
      text: "AirPods",
      style_class: "librepods-adwaita-hero-title",
    });

    let subtitleLabel = new St.Label({
      text: "Disconnected",
      style_class: "librepods-adwaita-hero-subtitle",
    });
    this._heroTitle = titleLabel;
    this._heroSubtitle = subtitleLabel;

    metaBox.add_child(titleLabel);
    metaBox.add_child(subtitleLabel);

    this._connSwitch = new PopupMenu.Switch(false);
    this._connSwitch.reactive = false;
    this._connSwitch.can_focus = false;

    heroBox.add_child(heroIcon);
    heroBox.add_child(metaBox);
    heroBox.add_child(this._connSwitch);

    heroCard.set_child(heroBox);

    let updateHeroState = () => {
      let isConn = this._isConnected;
      this._connSwitch.state = isConn;
      const name = this._deviceName || "AirPods";
      this._heroTitle.text = name;
      subtitleLabel.text = isConn ? "Connected" : "Disconnected";
      heroCard.style_class = isConn
        ? "popup-menu-item librepods-hero-item"
        : "popup-menu-item librepods-hero-item disconnected";
      if (this._batteryList) {
        this._batteryList.style_class = isConn
          ? "librepods-battery-list"
          : "librepods-battery-list disconnected";
      }
      if (this._settingCards) {
        this._settingCards.forEach((cardObj) => {
          this._updateCardStyle(cardObj, isConn);
        });
      }
    };

    this._updateHeroState = updateHeroState;
    heroCard.connect("clicked", () => {});

    this._mainBox.add_child(heroCard);

    // 2. SEGMENTED NAVIGATION TAB BAR — homogeneous via layout manager
    let tabBar = makeHomogeneousHBox("librepods-tab-pill-track");

    const tabs = [
      { id: "controls", label: "Controls" },
      { id: "battery", label: "Charge" },
      { id: "advanced", label: "Advanced" },
      { id: "info", label: "System" },
    ];

    this._tabButtons = {};
    this._tabContainers = {};

    tabs.forEach((t) => {
      let btn = new St.Button({
        label: t.label,
        style_class:
          t.id === "controls"
            ? "button active librepods-tab-pill-btn"
            : "button librepods-tab-pill-btn",
        can_focus: true,
        x_expand: true,
      });
      btn.connect("clicked", () => this._switchTab(t.id));
      tabBar.add_child(btn);
      this._tabButtons[t.id] = btn;
    });

    this._mainBox.add_child(tabBar);

    // 3. TAB VIEWS CONTAINER STACK
    this._viewsStack = new St.BoxLayout({
      vertical: true,
      style_class: "librepods-views-stack",
      x_expand: true,
    });

    let v1 = new St.BoxLayout({
      vertical: true,
      style_class: "librepods-view-page",
      visible: true,
      x_expand: true,
    });
    this._buildTab1Controls(v1);
    this._tabContainers["controls"] = v1;
    this._viewsStack.add_child(v1);

    let v2 = new St.BoxLayout({
      vertical: true,
      style_class: "librepods-view-page",
      visible: false,
      x_expand: true,
    });
    this._buildTab2Battery(v2);
    this._tabContainers["battery"] = v2;
    this._viewsStack.add_child(v2);

    let v3 = new St.BoxLayout({
      vertical: true,
      style_class: "librepods-view-page",
      visible: false,
      x_expand: true,
    });
    this._buildTab3Advanced(v3);
    this._tabContainers["advanced"] = v3;
    this._viewsStack.add_child(v3);

    let v4 = new St.BoxLayout({
      vertical: true,
      style_class: "librepods-view-page",
      visible: false,
      x_expand: true,
    });
    this._buildTab4Info(v4);
    this._tabContainers["info"] = v4;
    this._viewsStack.add_child(v4);

    this._mainBox.add_child(this._viewsStack);

    let menuItem = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
      style_class: "librepods-menu-wrapper",
    });
    menuItem.add_child(this._mainBox);
    this._indicator.menu.addMenuItem(menuItem);
    // Initialise D‑Bus connection after the UI is built
    this._initDBus();
  }

  // TAB 1 CONTROLS
  _buildTab1Controls(container) {
    let noiseGroup = new St.BoxLayout({
      vertical: true,
      style_class: "librepods-noise-group",
      x_expand: true,
    });

    noiseGroup.add_child(
      new St.Label({
        text: "NOISE CONTROL",
        style_class:
          "librepods-section-header-label librepods-section-header-label-first",
      }),
    );

    let noiseBtn = new St.Button({
      style_class: "button librepods-noise-pill-btn", // no `active` initially
      can_focus: true,
      x_expand: true,
    });

    let pillBox = new St.BoxLayout({
      style_class: "librepods-quick-pill-box", // reuse your grid pill styling
      x_expand: true,
    });

    let pillIcon = new St.Icon({
      icon_name: "audio-headphones-symbolic",
      style_class: "librepods-quick-pill-icon",
    });

    let pillTextStack = new St.BoxLayout({
      vertical: true,
      style_class: "librepods-quick-pill-text-stack",
      x_expand: true,
    });

    let pillTitle = new St.Label({
      text: "Noise Control",
      style_class: "librepods-quick-pill-title",
    });

    this._noisePillSubtitle = new St.Label({
      text: "Noise Cancellation",
      style_class: "librepods-quick-pill-subtitle",
    });

    pillTextStack.add_child(pillTitle);
    pillTextStack.add_child(this._noisePillSubtitle);

    this._noiseChevron = new St.Icon({
      icon_name: "go-next-symbolic",
      style_class: "librepods-quick-pill-chevron-icon",
    });

    pillBox.add_child(pillIcon);
    pillBox.add_child(pillTextStack);
    pillBox.add_child(this._noiseChevron);

    noiseBtn.set_child(pillBox);
    this._noiseBtn = noiseBtn;
    this._noiseExpanded = false;

    noiseBtn.connect("clicked", () => this._toggleNoiseOptions());

    noiseGroup.add_child(noiseBtn);

    // --- Inline expanding option list (Wi-Fi-list style, native ornaments) ---
    this._noiseOptionsBox = new St.BoxLayout({
      vertical: true,
      style_class: "librepods-noise-options",
      visible: false,
      x_expand: true,
    });

    const menuDefs = [
      { mode: NoiseMode.OFF, label: "Off" },
      { mode: NoiseMode.ANC, label: "Noise Cancellation" },
      { mode: NoiseMode.TRANSPARENCY, label: "Transparency" },
      { mode: NoiseMode.ADAPTIVE, label: "Adaptive" },
    ];

    this._noiseMenuItems = {};
    for (const { mode, label } of menuDefs) {
      let item = new PopupMenu.PopupMenuItem(label);
      item.add_style_class_name("librepods-noise-option-item");
      item.connect("activate", () => {
        this._setNoiseMode(mode); // updates UI immediately (optimistic)
        this._sendNoiseMode(mode); // tells the daemon
        this._collapseNoiseOptions();
      });
      this._noiseOptionsBox.add_child(item);
      this._noiseMenuItems[mode] = item;
    }

    noiseGroup.add_child(this._noiseOptionsBox);
    container.add_child(noiseGroup);

    // 2-Column QuickToggle Grid — homogeneous via layout manager
    let grid1 = makeHomogeneousHBox("librepods-quick-grid-row");
    let p1 = this._createQuickPill(
      "Spatial Audio",
      "Not in daemon yet",
      "audio-headphones-symbolic",
      false,
      { enabled: false },
    );
    let p2 = this._createQuickPill(
      "Adaptive Audio",
      "Not in daemon yet",
      "audio-volume-high-symbolic",
      false,
      { enabled: false },
    );
    grid1.add_child(p1);
    grid1.add_child(p2);
    container.add_child(grid1);

    let grid2 = makeHomogeneousHBox("librepods-quick-grid-row");
    let p3 = this._createQuickPill(
      "Conversation",
      "Off",
      "audio-input-microphone-symbolic",
      false,
      {
        id: "conversation",
        onToggle: (enabled) => this._setConversationDetect(enabled),
      },
    );
    let p4 = this._createQuickPill(
      "Personalized Volume",
      "Off",
      "audio-volume-high-symbolic",
      false,
      {
        id: "personalized",
        onToggle: (enabled) => this._setPersonalizedVolume(enabled),
      },
    );
    grid2.add_child(p3);
    grid2.add_child(p4);
    container.add_child(grid2);
  }

  _createQuickPill(title, subtitle, iconName, isActive = false, options = {}) {
    const enabled = options.enabled !== false || !!options.onToggle;
    let pillBtn = new St.Button({
      style_class: isActive
        ? "button active librepods-quick-pill-btn"
        : "button librepods-quick-pill-btn",
      can_focus: enabled,
      reactive: enabled,
      x_expand: true,
    });
    pillBtn._isActive = isActive;

    let box = new St.BoxLayout({
      vertical: false,
      style_class: "librepods-quick-pill-box",
      x_expand: true,
    });
    let icon = new St.Icon({
      icon_name: iconName,
      style_class: "librepods-quick-pill-icon",
    });
    box.add_child(icon);

    let textStack = new St.BoxLayout({
      vertical: true,
      style_class: "librepods-quick-pill-text-stack",
      x_expand: true,
    });
    let tLabel = new St.Label({
      text: title,
      style_class: "librepods-quick-pill-title",
    });
    let sLabel = new St.Label({
      text: subtitle,
      style_class: "librepods-quick-pill-subtitle",
    });
    textStack.add_child(tLabel);
    textStack.add_child(sLabel);
    box.add_child(textStack);

    let chevron = new St.Label({
      text: "›",
      style_class: "librepods-quick-pill-chevron",
    });
    box.add_child(chevron);

    pillBtn.set_child(box);

    pillBtn.connect("clicked", () => {
      if (!options.onToggle) return;
      pillBtn._isActive = !pillBtn._isActive;
      pillBtn.style_class = pillBtn._isActive
        ? "button active librepods-quick-pill-btn"
        : "button librepods-quick-pill-btn";
      options.onToggle(pillBtn._isActive);
    });

    this._pills.push(pillBtn);
    if (options.id) {
      this._quickPills[options.id] = {
        btn: pillBtn,
        subtitle: sLabel,
        setActive: (active, subtitleText) => {
          pillBtn._isActive = !!active;
          pillBtn.style_class = pillBtn._isActive
            ? "button active librepods-quick-pill-btn"
            : "button librepods-quick-pill-btn";
          if (subtitleText !== undefined) sLabel.text = subtitleText;
        },
      };
    }
    return pillBtn;
  }

  _buildTab2Battery(container) {
    let batteryBox = new St.BoxLayout({
      vertical: true,
      style_class: "librepods-battery-list",
      x_expand: true,
    });
    this._batteryList = batteryBox;
    this._batteryRows = {};

    const iconsDir = this.dir.get_child("icons");

    const devices = [
      {
        id: "left",
        name: "Left AirPod",
        pct: "—",
        widthPct: 0,
        iconFile: "airpod-left.svg",
        status: "Waiting for daemon",
      },
      {
        id: "right",
        name: "Right AirPod",
        pct: "—",
        widthPct: 0,
        iconFile: "airpod-right.svg",
        status: "Waiting for daemon",
      },
      {
        id: "case",
        name: "Case",
        pct: "—",
        widthPct: 0,
        iconFile: "airpod-case.svg",
        status: "Waiting for daemon",
      },
    ];

    devices.forEach((d) => {
      let row = new St.BoxLayout({
        vertical: false,
        style_class: "librepods-battery-row",
        x_expand: true,
      });

      let iconBox = new St.BoxLayout({
        style_class: "librepods-battery-row-icon-box",
      });
      let iconPath = iconsDir.get_child(d.iconFile).get_path();
      let icon = new St.Icon({
        gicon: Gio.Icon.new_for_string(iconPath),
        style_class: "popup-menu-icon librepods-battery-row-icon",
      });
      iconBox.add_child(icon);

      let infoBox = new St.BoxLayout({
        vertical: true,
        style_class: "librepods-battery-row-info",
        x_expand: true,
      });
      let nameLabel = new St.Label({
        text: d.name,
        style_class: "librepods-battery-row-title",
      });

      let barTrack = new St.BoxLayout({
        vertical: false,
        style_class: "librepods-battery-row-bar-track",
        x_expand: true,
      });
      let barFill = new St.Widget({
        style_class: "librepods-battery-row-bar-fill",
        x_expand: false,
        width: Math.round(180 * (d.widthPct / 100)),
      });
      barTrack.add_child(barFill);

      let statusLabel = new St.Label({
        text: d.status,
        style_class: "librepods-battery-row-sub",
      });

      infoBox.add_child(nameLabel);
      infoBox.add_child(barTrack);
      infoBox.add_child(statusLabel);

      let pctBadge = new St.Label({
        text: d.pct,
        style_class: "librepods-battery-row-pct",
      });

      this._batteryRows[d.id] = {
        pctLabel: pctBadge,
        barFill: barFill,
        statusLabel: statusLabel,
      };

      row.add_child(iconBox);
      row.add_child(infoBox);
      row.add_child(pctBadge);

      batteryBox.add_child(row);
    });

    container.add_child(batteryBox);
  }

  _buildTab3Advanced(container) {
    let advBox = new St.BoxLayout({
      vertical: true,
      style_class: "librepods-advanced-view-box",
      x_expand: true,
    });
    this._advancedBox = advBox;

    const sections = [
      {
        title: "INTELLIGENT AUDIO",
        items: [
          {
            id: "pers_vol",
            title: "Personalized Volume",
            desc: "Fine-tunes media volume in response to environmental conditions.",
            icon: "semi-starred-symbolic",
            active: false,
            writable: true,
          },
          {
            id: "conv_aware",
            title: "Conversational Awareness",
            desc: "Automatically lowers media volume and enhances voices when speaking.",
            icon: "audio-input-microphone-symbolic",
            active: false,
            writable: true,
          },
          {
            id: "loud_red",
            title: "Loud Sound Reduction",
            desc: "Not exposed by the daemon yet.",
            icon: "audio-volume-muted-symbolic",
            active: false,
            writable: false,
          },
        ],
      },
      {
        title: "HARDWARE & CONTROLS",
        items: [
          {
            id: "off_mode",
            title: "Off Listening Mode",
            desc: "Whether the buds currently allow cycling through Off on the stem.",
            icon: "media-playback-pause-symbolic",
            active: false,
            writable: true,
          },
          {
            id: "hires_mic",
            title: "Hi-Res Studio Mic",
            desc: "Not exposed on D-Bus yet.",
            icon: "audio-input-microphone-symbolic",
            active: false,
            writable: false,
          },
        ],
      },
    ];

    this._settingCards = [];

    sections.forEach((sec, idx) => {
      let header = new St.Label({
        text: sec.title,
        style_class:
          idx === 0
            ? "librepods-section-header-label"
            : "librepods-section-header-label librepods-section-header-label-second",
      });
      advBox.add_child(header);

      let groupList = new St.BoxLayout({
        vertical: true,
        style_class: "librepods-settings-group-list",
        x_expand: true,
      });

      sec.items.forEach((item) => {
        let card = new St.Button({
          style_class: item.active
            ? "librepods-hero-item librepods-setting-card-item"
            : "librepods-hero-item librepods-setting-card-item item-disabled",
          can_focus: true,
          x_expand: true,
        });
        card._itemId = item.id;
        card._writable = !!item.writable;

        let box = new St.BoxLayout({
          vertical: false,
          style_class: "librepods-adwaita-hero-box",
          x_expand: true,
        });

        let icon = new St.Icon({
          icon_name: item.icon,
          style_class: "popup-menu-icon librepods-hero-icon",
        });

        let textStack = new St.BoxLayout({
          vertical: true,
          style_class: "librepods-hero-text-box",
          x_expand: true,
        });

        let titleLabel = new St.Label({
          text: item.title,
          style_class: "librepods-adwaita-hero-title",
        });

        let descLabel = new St.Label({
          text: item.desc,
          style_class: "librepods-adwaita-hero-subtitle",
          x_expand: true,
        });
        let ct = descLabel.get_clutter_text
          ? descLabel.get_clutter_text()
          : null;
        if (ct) {
          ct.line_wrap = true;
          ct.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
          ct.ellipsize = Pango.EllipsizeMode.NONE;
        }

        textStack.add_child(titleLabel);
        textStack.add_child(descLabel);

        let toggleSwitch = new PopupMenu.Switch(item.active);

        box.add_child(icon);
        box.add_child(textStack);
        box.add_child(toggleSwitch);

        card.set_child(box);

        let cardObj = {
          card,
          toggleSwitch,
          id: item.id,
          writable: !!item.writable,
        };

        let syncCardState = () => {
          this._updateCardStyle(cardObj, this._isConnected);
        };

        toggleSwitch.reactive = false;
        toggleSwitch.can_focus = false;
        toggleSwitch.connect("notify::state", syncCardState);

        card.connect("clicked", () => {
          if (!this._isConnected || !card._writable) return;
          const next = !toggleSwitch.state;
          if (item.id === "conv_aware") this._setConversationDetect(next);
          else if (item.id === "pers_vol") this._setPersonalizedVolume(next);
          else if (item.id === "off_mode") this._setAllowOff(next);
        });

        this._settingCards.push(cardObj);
        this._settingById[item.id] = cardObj;
        groupList.add_child(card);
      });

      advBox.add_child(groupList);
    });

    container.add_child(advBox);
  }

  _updateCardStyle(cardObj, isGlobalConnected) {
    let { card, toggleSwitch } = cardObj;
    let isActive = toggleSwitch.state;

    // Toggle interactivity: lock card button and switch when globally disconnected
    card.reactive = isGlobalConnected && !!cardObj.writable;
    card.can_focus = isGlobalConnected && !!cardObj.writable;
    toggleSwitch.reactive = false;

    if (!isGlobalConnected) {
      card.style_class =
        "librepods-hero-item librepods-setting-card-item globally-disabled";
    } else if (!isActive) {
      card.style_class =
        "librepods-hero-item librepods-setting-card-item item-disabled";
    } else {
      card.style_class = "librepods-hero-item librepods-setting-card-item";
    }
  }

  _buildTab4Info(container) {
    let card = new St.BoxLayout({
      vertical: true,
      style_class: "button librepods-info-card",
      x_expand: true,
    });

    const infoRows = [
      { id: "name", k: "Name", v: "—" },
      { id: "address", k: "Bluetooth Address", v: "—" },
      { id: "listening", k: "Listening Mode", v: "—" },
      { id: "ear", k: "Ear Detection (primary / secondary)", v: "—" },
      { id: "awareness", k: "Conversation Ducking", v: "—" },
    ];

    infoRows.forEach((r) => {
      let row = new St.BoxLayout({
        vertical: false,
        style_class: "librepods-info-row",
        x_expand: true,
      });
      let kLabel = new St.Label({
        text: r.k,
        style_class: "librepods-info-key",
        x_expand: true,
      });
      let vLabel = new St.Label({
        text: r.v,
        style_class: "librepods-info-val",
      });
      row.add_child(kLabel);
      row.add_child(vLabel);
      if (r.id) this._infoValues[r.id] = vLabel;
      card.add_child(row);
    });

    container.add_child(card);
  }

  _setNoiseMode(modeId) {
    const modeNum = normalizeNoiseMode(modeId);
    this._noiseMode = modeNum;

    if (this._noiseBtn) {
      this._noiseBtn.style_class =
        modeNum === NoiseMode.OFF
          ? "button librepods-noise-pill-btn"
          : "button librepods-noise-pill-btn active";
    }

    if (this._noisePillSubtitle)
      this._noisePillSubtitle.text = listeningModeLabel(modeNum);

    if (this._noiseMenuItems) {
      for (const [mode, item] of Object.entries(this._noiseMenuItems)) {
        item.setOrnament(
          Number(mode) === modeNum
            ? PopupMenu.Ornament.CHECK
            : PopupMenu.Ornament.NONE,
        );
      }
    }
  }

  _toggleNoiseOptions() {
    this._noiseExpanded = !this._noiseExpanded;
    if (this._noiseOptionsBox)
      this._noiseOptionsBox.visible = this._noiseExpanded;
    if (this._noiseChevron)
      this._noiseChevron.icon_name = this._noiseExpanded
        ? "go-down-symbolic"
        : "go-next-symbolic";
  }

  _collapseNoiseOptions() {
    if (!this._noiseExpanded) return;
    this._noiseExpanded = false;
    if (this._noiseOptionsBox) this._noiseOptionsBox.visible = false;
    if (this._noiseChevron) this._noiseChevron.icon_name = "go-next-symbolic";
  }

  _sendNoiseMode(mode) {
    if (!this._dbusProxy) return;
    this._dbusProxy.SetListeningModeRemote(mode, (_r, error) => {
      if (error) {
        log("SetListeningMode failed: " + error.message);
        this._syncFromDBus();
      }
    });
  }

  _updateBatteryUI() {
    if (!this._batteryRows) return;

    try {
      const rows = {
        left: {
          pct: batteryPct(this._getDBusProperty("BatteryLeft")),
          status: this._getDBusProperty("BatteryLeftStatus"),
        },
        right: {
          pct: batteryPct(this._getDBusProperty("BatteryRight")),
          status: this._getDBusProperty("BatteryRightStatus"),
        },
        case: {
          pct: batteryPct(this._getDBusProperty("BatteryCase")),
          status: this._getDBusProperty("BatteryCaseStatus"),
        },
      };

      Object.entries(rows).forEach(([id, values]) => {
        const row = this._batteryRows[id];
        if (!row) return;
        const hasLevel = values.pct !== null;
        row.pctLabel.text = hasLevel ? `${values.pct}%` : "—";
        row.barFill.width = Math.round(
          180 * ((hasLevel ? values.pct : 0) / 100),
        );
        row.statusLabel.text = batteryStatusLabel(values.status);
      });
    } catch (e) {
      log("Failed to update battery UI: " + e.message);
    }
  }

  _setConversationDetect(enabled) {
    if (!this._dbusProxy) {
      this._syncFromDBus();
      return;
    }
    this._dbusProxy.SetConversationDetectRemote(enabled, (_result, error) => {
      if (error) {
        log("Failed to set conversation detect via D-Bus: " + error.message);
        this._syncFromDBus();
      }
    });
  }

  _setPersonalizedVolume(enabled) {
    if (!this._dbusProxy) return;
    this._dbusProxy.SetPersonalizedVolumeRemote(enabled, (_result, error) => {
      if (error) {
        log("Failed to set personalized volume via D-Bus: " + error.message);
        this._syncFromDBus();
      }
    });
  }

  _setAllowOff(enabled) {
    if (!this._dbusProxy) return;
    this._dbusProxy.SetAllowOffRemote(enabled, (_result, error) => {
      if (error) {
        log("Failed to set allow-off via D-Bus: " + error.message);
        this._syncFromDBus();
      }
    });
  }

  _setSettingToggle(id, active) {
    const cardObj = this._settingById?.[id];
    if (cardObj) cardObj.toggleSwitch.state = !!active;
  }

  _syncFromDBus() {
    const connected = !!this._getDBusProperty("Connected");
    this._isConnected = connected;
    this._deviceName = this._getDBusProperty("DeviceName") || "AirPods";
    if (this._updateHeroState) this._updateHeroState();

    // Noise pill mirrors quick-settings behavior: insensitive while off/disconnected
    if (this._noiseBtn) {
      this._noiseBtn.reactive = connected;
      this._noiseBtn.can_focus = connected;
    }
    if (!connected) this._collapseNoiseOptions();

    this._setNoiseMode(this._getDBusProperty("ListeningMode"));
    const allowOff = Number(this._getDBusProperty("AllowOff")) === 1;

    const conversation = !!this._getDBusProperty("ConversationDetect");
    const ducking = Number(
      this._getDBusProperty("ConversationalAwareness") || 0,
    );
    this._quickPills?.conversation?.setActive(
      conversation,
      ducking ? `Ducking ${ducking}` : conversation ? "On" : "Off",
    );
    this._setSettingToggle("conv_aware", conversation);

    const personalized = !!this._getDBusProperty("PersonalizedVolume");
    this._quickPills?.personalized?.setActive(
      personalized,
      personalized ? "On" : "Off",
    );
    this._setSettingToggle("pers_vol", personalized);
    this._setSettingToggle("off_mode", allowOff);

    if (this._settingCards)
      this._settingCards.forEach((cardObj) =>
        this._updateCardStyle(cardObj, connected),
      );

    if (this._infoValues.name)
      this._infoValues.name.text = this._deviceName || "—";
    if (this._infoValues.address)
      this._infoValues.address.text = this._getDBusProperty("Address") || "—";
    if (this._infoValues.listening)
      this._infoValues.listening.text = listeningModeLabel(
        this._getDBusProperty("ListeningMode"),
      );
    if (this._infoValues.ear)
      this._infoValues.ear.text = `${earStatusLabel(this._getDBusProperty("EarPrimary"))} / ${earStatusLabel(this._getDBusProperty("EarSecondary"))}`;
    if (this._infoValues.awareness)
      this._infoValues.awareness.text = String(
        this._getDBusProperty("ConversationalAwareness") ?? "—",
      );

    this._updateBatteryUI();
  }

  _initDBus() {
    try {
      const ifaceXml = `
        <node>
          <interface name='org.librepods.Service'>
            <method name='SetListeningMode'>
              <arg type='y' name='mode' direction='in'/>
            </method>
            <method name='SetConversationDetect'>
              <arg type='b' name='enabled' direction='in'/>
            </method>
            <method name='SetPersonalizedVolume'>
              <arg type='b' name='enabled' direction='in'/>
            </method>
            <method name='SetAllowOff'>
              <arg type='b' name='enabled' direction='in'/>
            </method>
            <property name='Connected' type='b' access='read'/>
            <property name='Address' type='s' access='read'/>
            <property name='DeviceName' type='s' access='read'/>
            <property name='ListeningMode' type='y' access='read'/>
            <property name='AllowOff' type='y' access='read'/>
            <property name='ConversationDetect' type='b' access='read'/>
            <property name='PersonalizedVolume' type='b' access='read'/>
            <property name='BatteryHeadphone' type='y' access='read'/>
            <property name='BatteryHeadphoneStatus' type='y' access='read'/>
            <property name='BatteryLeft' type='y' access='read'/>
            <property name='BatteryLeftStatus' type='y' access='read'/>
            <property name='BatteryRight' type='y' access='read'/>
            <property name='BatteryRightStatus' type='y' access='read'/>
            <property name='BatteryCase' type='y' access='read'/>
            <property name='BatteryCaseStatus' type='y' access='read'/>
            <property name='EarPrimary' type='y' access='read'/>
            <property name='EarSecondary' type='y' access='read'/>
            <property name='ConversationalAwareness' type='y' access='read'/>
          </interface>
        </node>`;
      const DBusProxy = Gio.DBusProxy.makeProxyWrapper(ifaceXml);
      this._dbusProxy = new DBusProxy(
        Gio.DBus.session,
        "org.librepods.Service",
        "/org/librepods/Service",
      );

      this._dbusProxy.connect("g-properties-changed", () => {
        this._syncFromDBus();
      });

      this._indicator.menu.connect("open-state-changed", (_menu, isOpen) => {
        if (!isOpen) return;
        this._syncFromDBus();
      });

      this._syncFromDBus();
    } catch (e) {
      log("Failed to initialize librepods DBus proxy: " + e.message);
    }
  }

  _switchTab(tabId) {
    if (this._activeTab === tabId) return;

    this._activeTab = tabId;
    if (tabId !== "controls") this._collapseNoiseOptions();
    Object.keys(this._tabButtons || {}).forEach((id) => {
      if (id === tabId) {
        this._tabButtons[id].style_class =
          "button active librepods-tab-pill-btn";
        this._tabContainers[id].visible = true;
      } else {
        this._tabButtons[id].style_class = "button librepods-tab-pill-btn";
        this._tabContainers[id].visible = false;
      }
    });

    this._syncFromDBus();
  }
}
