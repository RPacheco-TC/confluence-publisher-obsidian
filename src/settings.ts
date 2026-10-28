import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import { INSTALL_LINE } from './texts.ts';

/** Saved settings; the keys and defaults are those of 0.1.0 (AC-F.4). */
export interface PublisherSettings {
  cpubPath: string;
  showRibbon: boolean;
  timeoutSeconds: number;
}

export const DEFAULT_SETTINGS: PublisherSettings = {
  cpubPath: '',
  showRibbon: true,
  timeoutSeconds: 120,
};

/** What the settings tab needs from the plugin. */
export interface SettingsHost extends Plugin {
  settings: PublisherSettings;
  saveSettings(): Promise<void>;
  updateRibbon(): void;
  detectedCpub(): string | null;
  forgetCpubVersions(): void;
  runCheck(): Promise<void>;
}

export class PublisherSettingTab extends PluginSettingTab {
  private readonly host: SettingsHost;

  constructor(app: App, host: SettingsHost) {
    super(app, host);
    this.host = host;
  }

  display(): void {
    const { containerEl } = this;
    const host = this.host;
    containerEl.empty();
    const detected = host.detectedCpub();

    new Setting(containerEl)
      .setName('cpub path')
      .setDesc(detected ? `Leave empty to use the detected ${detected}.` :
        `cpub was not found in the usual places. Install it with: ${INSTALL_LINE}`)
      .addText((t) => t
        .setPlaceholder(detected || '/Users/you/.local/bin/cpub')
        .setValue(host.settings.cpubPath)
        .onChange(async (v) => {
          host.settings.cpubPath = v.trim();
          host.forgetCpubVersions();
          await host.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show ribbon button')
      .setDesc('A ribbon button that publishes the current note.')
      .addToggle((t) => t
        .setValue(host.settings.showRibbon)
        .onChange(async (v) => {
          host.settings.showRibbon = v;
          host.updateRibbon();
          await host.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Timeout (seconds)')
      .setDesc('cpub is stopped if it takes longer than this. Rendering many diagrams ' +
        'can take a while.')
      .addText((t) => t
        .setPlaceholder(String(DEFAULT_SETTINGS.timeoutSeconds))
        .setValue(String(host.settings.timeoutSeconds))
        .onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 10) {
            host.settings.timeoutSeconds = Math.round(n);
            await host.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Check cpub setup')
      .setDesc('Runs cpub check: credentials, connection, sign-in and diagrams.')
      .addButton((b) => b.setButtonText('Run check').onClick(() => host.runCheck()));
  }
}
