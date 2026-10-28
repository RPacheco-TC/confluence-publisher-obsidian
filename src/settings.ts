import {
  PluginSettingTab, Setting, type App, type Plugin, type SettingDefinitionItem,
} from 'obsidian';
import { INSTALL_LINE } from './texts.ts';

import {
  DEFAULT_SETTINGS, MIN_TIMEOUT_SECONDS, isValidTimeout, type PublisherSettings,
} from './settings-data.ts';

export { DEFAULT_SETTINGS, type PublisherSettings };

/** What the settings tab needs from the plugin. */
export interface SettingsHost extends Plugin {
  settings: PublisherSettings;
  saveSettings(): Promise<void>;
  updateRibbon(): void;
  /**
   * The last detection result: a path, ``null`` (not found) or ``undefined`` (not
   * run yet). Detection runs cpub, so it happens on first use, never at startup.
   */
  detectedCpub(): string | null | undefined;
  refreshDetectedCpub(): Promise<void>;
  forgetCpubVersions(): void;
  runCheck(): Promise<void>;
}

type Key = keyof PublisherSettings;
const TIMEOUT_ERROR = `At least ${MIN_TIMEOUT_SECONDS} seconds.`;

/**
 * The settings: declarative (getSettingDefinitions, searchable in Obsidian >= 1.13)
 * with display() as the fallback for older apps (AC-G.5). Both write through
 * ``apply``, so validation and side effects are the same in either.
 */
export class PublisherSettingTab extends PluginSettingTab {
  private readonly host: SettingsHost;

  constructor(app: App, host: SettingsHost) {
    super(app, host);
    this.host = host;
  }

  private pathDesc(): string {
    const detected = this.host.detectedCpub();
    if (detected === undefined) {
      return 'Leave empty to find cpub automatically in ~/.local/bin, /opt/homebrew/bin ' +
        'or /usr/local/bin.';
    }
    return detected ? `Leave empty to use the detected ${detected}.` :
      `cpub was not found in the usual places. Install it with: ${INSTALL_LINE}`;
  }

  /** Detect cpub again in the background, then redraw with the result. */
  private refresh(redraw: () => void): void {
    void this.host.refreshDetectedCpub().then(redraw);
  }

  /** Also called once at load for search indexing, so it never runs cpub itself. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const host = this.host;
    return [
      {
        name: 'cpub path',
        desc: this.pathDesc(),
        control: { type: 'text', key: 'cpubPath', defaultValue: DEFAULT_SETTINGS.cpubPath,
          placeholder: host.detectedCpub() || '/Users/you/.local/bin/cpub' },
      },
      {
        name: 'Show ribbon button',
        desc: 'A ribbon button that publishes the current note.',
        control: { type: 'toggle', key: 'showRibbon', defaultValue: DEFAULT_SETTINGS.showRibbon },
      },
      {
        name: 'Timeout (seconds)',
        desc: 'cpub is stopped if it takes longer than this. Rendering many diagrams can ' +
          'take a while.',
        control: { type: 'number', key: 'timeoutSeconds', min: MIN_TIMEOUT_SECONDS, step: 1,
          defaultValue: DEFAULT_SETTINGS.timeoutSeconds,
          validate: (v: number) => (isValidTimeout(v) ? undefined : TIMEOUT_ERROR) },
      },
      {
        name: 'Check cpub setup',
        desc: 'Runs cpub check: credentials, connection, sign-in and diagrams.',
        action: () => { void host.runCheck(); },
      },
    ];
  }

  private refreshed = false;

  hide(): void {
    this.refreshed = false;
    super.hide();
  }

  getControlValue(key: string): unknown {
    return key in this.host.settings ? this.host.settings[key as Key] : undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    await this.apply(key as Key, value);
  }

  /** The one write path: validate, store, side effects, persist. */
  private async apply(key: Key, value: unknown): Promise<void> {
    const host = this.host;
    if (key === 'cpubPath' && typeof value === 'string') {
      host.settings.cpubPath = value.trim();
      host.forgetCpubVersions();
    } else if (key === 'showRibbon' && typeof value === 'boolean') {
      host.settings.showRibbon = value;
      host.updateRibbon();
    } else if (key === 'timeoutSeconds' && isValidTimeout(value)) {
      host.settings.timeoutSeconds = Math.round(value);
    } else {
      return;                                       // invalid: nothing stored
    }
    await host.saveSettings();
  }

  /** Obsidian < 1.13 only (not called when getSettingDefinitions returns items). */
  display(): void {
    const { containerEl } = this;
    const host = this.host;
    containerEl.empty();
    if (!this.refreshed) {
      this.refreshed = true;
      this.refresh(() => this.display());
    }

    new Setting(containerEl)
      .setName('cpub path')
      .setDesc(this.pathDesc())
      .addText((t) => t
        .setPlaceholder(host.detectedCpub() || '/Users/you/.local/bin/cpub')
        .setValue(host.settings.cpubPath)
        .onChange((v) => this.apply('cpubPath', v)));

    new Setting(containerEl)
      .setName('Show ribbon button')
      .setDesc('A ribbon button that publishes the current note.')
      .addToggle((t) => t
        .setValue(host.settings.showRibbon)
        .onChange((v) => this.apply('showRibbon', v)));

    new Setting(containerEl)
      .setName('Timeout (seconds)')
      .setDesc('cpub is stopped if it takes longer than this. Rendering many diagrams ' +
        'can take a while.')
      .addText((t) => t
        .setPlaceholder(String(DEFAULT_SETTINGS.timeoutSeconds))
        .setValue(String(host.settings.timeoutSeconds))
        .onChange((v) => this.apply('timeoutSeconds', Number(v))));

    new Setting(containerEl)
      .setName('Check cpub setup')
      .setDesc('Runs cpub check: credentials, connection, sign-in and diagrams.')
      .addButton((b) => b.setButtonText('Run check').onClick(() => { void host.runCheck(); }));
  }
}
