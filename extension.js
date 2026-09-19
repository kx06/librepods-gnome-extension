import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {LibrePodsIndicator} from './indicator.js';

export default class LibrePodsExtension extends Extension {
    enable() {
        this._indicator = new LibrePodsIndicator(this.dir);
        Main.panel.addToStatusArea(this.metadata.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
