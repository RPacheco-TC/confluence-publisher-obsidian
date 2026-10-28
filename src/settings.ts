import {
  PluginSettingTab, type App, type Plugin, type SettingDefinitionItem,
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
 * The settings, declared with getSettingDefinitions (Obsidian >= 1.13, searchable).
 * Every change goes through ``apply``: validate, store, side effects, persist.
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
        name: 'Detect cpub',
        desc: 'Look for cpub in the usual folders now and show the result above.',
        action: () => { void host.refreshDetectedCpub(); },   // redraws via update()
      },
      {
        name: 'Check cpub setup',
        desc: 'Runs cpub check: credentials, connection, sign-in and diagrams.',
        action: () => { void host.runCheck(); },
      },
    ];
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
}
