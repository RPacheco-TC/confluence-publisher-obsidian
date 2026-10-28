/*
 * Confluence Publisher: publish the current Obsidian note to Confluence Cloud by
 * running the `cpub` command-line tool.
 *
 * The plugin never reads, stores or sends Confluence credentials and makes no
 * network request itself: only `cpub` talks to Confluence (D32). It runs cpub with
 * spawn and no shell, passes the note as one absolute path, and never passes
 * --adopt or runs undo.
 */
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import {
  FileSystemAdapter, MarkdownView, Notice, Plugin, type TFile,
} from 'obsidian';
import { CpubCommand } from './cpub-command.ts';
import { CpubArgs, CpubLocator, CpubRunner, type RunResult } from './cpub/runner.ts';
import {
  DEFAULT_SETTINGS, PublisherSettingTab, type PublisherSettings, type SettingsHost,
} from './settings.ts';
import { KINDS, type NoteKind } from './texts.ts';
import { Notifier } from './ui/notifier.ts';

export default class ConfluencePublisherPlugin extends Plugin implements SettingsHost {
  settings: PublisherSettings = { ...DEFAULT_SETTINGS };
  private running = false;
  private ribbon: HTMLElement | null = null;
  private notifier!: Notifier;
  private cpub!: CpubCommand;
  private readonly runner = new CpubRunner(spawn);

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.notifier = new Notifier(this.app, () => this.timeoutMs());
    this.cpub = new CpubCommand(homedir, () => this.settings.cpubPath || '',
      (cmd, args, timeoutMs) => this.exec(cmd, args, timeoutMs),
      (text) => { this.notifier.message(text, 0); });

    // The ids and names are those of 0.1.0, so existing hotkeys keep working (AC-F.4).
    this.addCommand({
      id: 'publish-current-note',
      name: 'Publish current note to Confluence',
      checkCallback: (checking) => this.noteCommand(checking, 'publish'),
    });
    this.addCommand({
      id: 'preview-publish',
      name: 'Preview publish (dry run)',
      checkCallback: (checking) => this.noteCommand(checking, 'dry'),
    });
    this.addCommand({
      id: 'check-cpub-setup',
      name: 'Check cpub setup',
      callback: () => { void this.runCheck(); },
    });
    this.addSettingTab(new PublisherSettingTab(this.app, this));
    this.updateRibbon();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  updateRibbon(): void {
    if (this.settings.showRibbon && !this.ribbon) {
      this.ribbon = this.addRibbonIcon('upload', 'Publish current note to Confluence', () => {
        const file = this.activeNote();
        if (file) void this.publish(file, 'publish');
        else new Notice('Open a Markdown note to publish it to Confluence.');
      });
    } else if (!this.settings.showRibbon && this.ribbon) {
      this.ribbon.remove();
      this.ribbon = null;
    }
  }

  detectedCpub(): string | null {
    return this.cpub.detected();
  }

  forgetCpubVersions(): void {
    this.cpub.forget();
  }

  // -- environment --

  private adapter(): FileSystemAdapter | null {
    const a = this.app.vault.adapter;
    return a instanceof FileSystemAdapter ? a : null;
  }

  private activeNote(): TFile | null {
    const file = this.app.workspace.getActiveFile();
    return file && file.extension === 'md' && this.adapter() ? file : null;
  }

  private timeoutMs(): number {
    const s = Number(this.settings.timeoutSeconds);
    return (Number.isFinite(s) && s >= 10 ? s : DEFAULT_SETTINGS.timeoutSeconds) * 1000;
  }

  /** cpub with the vault root as cwd (else the home folder) and a PATH that finds it. */
  private exec(cmd: string, args: string[], timeoutMs: number): Promise<RunResult> {
    const adapter = this.adapter();
    return this.runner.run(cmd, args, {
      cwd: adapter ? adapter.getBasePath() : homedir(),
      env: new CpubLocator(homedir()).childEnv(process.env),
      timeoutMs,
    });
  }

  // -- commands --

  private noteCommand(checking: boolean, kind: NoteKind): boolean {
    const file = this.activeNote();
    if (checking) return !!file;
    if (file) void this.publish(file, kind);
    return true;
  }

  private async publish(file: TFile, kind: NoteKind): Promise<void> {
    if (this.running) {
      new Notice('cpub is already running; wait for it to finish.');
      return;
    }
    this.running = true;
    let progress: Notice | null = null;
    try {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view && view.file === file) await view.save();        // publish what is on screen
      const cmd = await this.cpub.resolve();
      const adapter = this.adapter();
      if (!cmd || !adapter) return;
      const args = CpubArgs.build(kind, adapter.getFullPath(file.path));
      progress = new Notice(`${KINDS[kind].running} ${file.basename}…`, 0);
      const res = await this.exec(cmd, args, this.timeoutMs());
      progress.hide();
      progress = null;
      this.notifier.report(res, `${KINDS[kind].done}: ${file.basename}`, `cpub ${file.name}`,
        kind);
    } catch (e) {
      this.notifier.message(`Could not run cpub: ${e instanceof Error ? e.message : e}`, 0);
    } finally {
      if (progress) progress.hide();
      this.running = false;
    }
  }

  async runCheck(): Promise<void> {
    if (this.running) {
      new Notice('cpub is already running; wait for it to finish.');
      return;
    }
    this.running = true;
    try {
      const cmd = await this.cpub.resolve();
      if (!cmd) return;
      const res = await this.exec(cmd, CpubArgs.build('check'), this.timeoutMs());
      this.notifier.showOutput(res.code === 0 ? 'cpub check: ready' :
        'cpub check: something to fix', res);
    } catch (e) {
      this.notifier.message(`Could not run cpub: ${e instanceof Error ? e.message : e}`, 0);
    } finally {
      this.running = false;
    }
  }
}
