'use strict';
/*
 * Confluence Publisher — publish the current Obsidian note to Confluence Cloud
 * by running the `cpub` command-line tool.
 *
 * Plain JavaScript with no build step and no dependencies (AC-E.1): Obsidian
 * installs only main.js, manifest.json and styles.css, so the pure logic lives
 * in this file too, in the PURE section below, which never touches Obsidian and
 * is tested with `node --test` (test/*.test.js require('../main.js').pure).
 *
 * The plugin never reads, stores or sends Confluence credentials and makes no
 * network request itself: only `cpub` talks to Confluence (AC-E.7).
 */

// === PURE (node --test) ======================================================
// Everything cpub-specific that needs no Obsidian: where cpub is, the PATH it runs
// with, its arguments, its version and what its output means. Node built-ins only;
// no require('obsidian'), no network, no credentials. Tested by test/pure.test.js.
const path = require('path');

const MIN_CPUB = '1.4.0';
// Where uv/pipx (~/.local/bin) and Homebrew put cpub; Obsidian's own PATH is minimal.
const BIN_DIRS = (home) => [path.join(home, '.local', 'bin'), '/opt/homebrew/bin',
  '/usr/local/bin'];

/** The places cpub is looked for, in order. */
function cpubCandidates(home) {
  return BIN_DIRS(home).map((dir) => path.join(dir, 'cpub'));
}

/** The first candidate `exists(path)` accepts, or null. A throwing check means no. */
function detectCpub(home, exists) {
  for (const candidate of cpubCandidates(home)) {
    try {
      if (exists(candidate)) return candidate;
    } catch (e) { /* unreadable: try the next one */ }
  }
  return null;
}

/** A copy of `env` whose PATH also holds the three bin folders (npx needs node). */
function childEnv(env, home) {
  const parts = String((env && env.PATH) || '').split(path.delimiter).filter(Boolean);
  for (const dir of BIN_DIRS(home)) if (!parts.includes(dir)) parts.push(dir);
  return Object.assign({}, env, { PATH: parts.join(path.delimiter) });
}

/** Whether `p` is an absolute path on macOS/Linux ('/...') or Windows ('C:\\...'). */
function isAbsolutePath(p) {
  return typeof p === 'string' && !p.startsWith('-') &&
    (path.posix.isAbsolute(p) || path.win32.isAbsolute(p));
}

/**
 * cpub's arguments. Never --adopt or any write-forcing flag. The note path must be
 * absolute, so a note named '--adopt.md' can never be read as an option: an
 * absolute path never starts with '-'.
 */
function buildArgs(kind, notePath) {
  if (kind === 'check') return ['check'];
  if (kind !== 'publish' && kind !== 'dry') throw new Error(`unknown command ${kind}`);
  if (!isAbsolutePath(notePath)) throw new Error('the note path must be absolute');
  return kind === 'dry' ? [notePath, '--dry-run'] : [notePath];
}

/** 'cpub 1.4.0' -> '1.4.0'; null when there is no x.y.z in it. */
function parseVersion(stdout) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(stdout || ''));
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/** Whether version `v` (x.y.z) is at least `min`; false for null. */
function atLeast(v, min) {
  if (!v) return false;
  const a = v.split('.').map(Number), b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

const KILL_GRACE_MS = 3000;
const OUTPUT_LIMIT = 16 * 1024 * 1024;

/**
 * Run cpub through an injected child_process.spawn: no shell, ever; stdin closed, so
 * cpub can never wait for a prompt. cpub starts in its own process group, so a
 * timeout stops it AND its children (npx, node, the headless browser that renders
 * diagrams): SIGTERM to the group, then SIGKILL after a grace period (on Windows,
 * which has no process groups: `taskkill /pid <pid> /T /F`, no shell). Always
 * resolves (never rejects) with {code, stdout, stderr, timedOut, spawnError}.
 *
 * @param spawn child_process.spawn (injected for tests).
 * @param opts {cwd, env, timeoutMs, kill = process.kill, platform = process.platform,
 *   graceMs, setTimer = setTimeout, clearTimer = clearTimeout,
 *   execFile = child_process.execFile (Windows taskkill only)}
 */
function runCpub(spawn, cmd, args, opts) {
  const { cwd, env, timeoutMs } = opts;
  const kill = opts.kill || process.kill.bind(process);
  const platform = opts.platform || process.platform;
  const graceMs = opts.graceMs === undefined ? KILL_GRACE_MS : opts.graceMs;
  const setTimer = opts.setTimer || setTimeout, clearTimer = opts.clearTimer || clearTimeout;
  return new Promise((resolve) => {
    const out = { code: null, stdout: '', stderr: '', timedOut: false, spawnError: null };
    let child, done = false, timer = null, killTimer = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimer(timer);
      // after a timeout the group SIGKILL still fires: a child that ignored SIGTERM
      // must not outlive cpub (killing a group that is gone is harmless)
      if (!out.timedOut) clearTimer(killTimer);
      resolve(out);
    };
    const stop = (signal) => {
      try {
        if (platform !== 'win32') {
          kill(-child.pid, signal);                          // the whole group
        } else if (signal === 'SIGTERM') {                   // no groups: the whole tree
          const execFile = opts.execFile || require('child_process').execFile;
          execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'],
            { shell: false, windowsHide: true }, () => {});
        } else {
          child.kill(signal);                                // last resort
        }
      } catch (e) { /* already gone */ }
    };
    try {
      child = spawn(cmd, args, { cwd, env, shell: false, detached: platform !== 'win32',
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      out.spawnError = e.code || String(e);
      finish();
      return;
    }
    const collect = (key) => (chunk) => {
      if (out[key].length < OUTPUT_LIMIT) out[key] += String(chunk);
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.on('error', (e) => {                               // e.g. ENOENT: wrong path
      out.spawnError = e.code || String(e);
      finish();
    });
    child.on('close', (code) => {
      out.code = typeof code === 'number' && !out.timedOut ? code : null;
      finish();
    });
    if (timeoutMs) {
      timer = setTimer(() => {
        out.timedOut = true;
        stop('SIGTERM');
        killTimer = setTimer(() => stop('SIGKILL'), graceMs);
      }, timeoutMs);
    }
  });
}

const firstLine = (text, re) => {
  for (const line of String(text).split(/\r?\n/)) {
    const m = re.exec(line);
    if (m) return m[1].trim();
  }
  return null;
};

/**
 * What a cpub run means: {ok, pageUrl, error, fix, headline}. pageUrl comes from a
 * 'Page: <url>' or 'Parent page: <url>' line (the replace preview's indented
 * '  Page:     <title>' is not one); error/fix from cpub's 'Error:'/'Fix:' lines.
 */
function summarize(result) {
  const all = `${result.stdout || ''}\n${result.stderr || ''}`;
  const pageUrl = firstLine(all, /^(?:Parent page|Page): (https?:\/\/\S+)\s*$/);
  const lines = String(result.stdout || '').split(/\r?\n/).map((l) => l.trim())
    .filter(Boolean);
  const headline = lines.find((l) => /^\d+ pages? .+ — space /.test(l)) ||
    lines[lines.length - 1] || null;
  let error = firstLine(all, /^Error: (.+)$/);
  const fix = firstLine(all, /^Fix: (.+)$/);
  if (result.timedOut) error = 'cpub did not finish in time and was stopped.';
  else if (result.spawnError) error = `cpub could not be started (${result.spawnError}).`;
  else if (!error && result.code) {
    error = firstLine(all, /^\S+: error: (.+)$/) || `cpub exited with status ${result.code}.`;
  }
  const ok = result.code === 0 && !result.timedOut && !result.spawnError;
  return { ok, pageUrl, error: ok ? null : error, fix: ok ? null : fix, headline };
}

const pure = { MIN_CPUB, KILL_GRACE_MS, cpubCandidates, detectCpub, childEnv, buildArgs,
  parseVersion, atLeast, runCpub, summarize };

// === END PURE ================================================================

let obsidian = null;
try {
  obsidian = require('obsidian');          // absent under `node --test`
} catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND') throw e;
}

const DEFAULT_SETTINGS = { cpubPath: '', showRibbon: true, timeoutSeconds: 120 };
const INSTALL_LINE =
  'uv tool install git+https://github.com/RPacheco-TC/obx-confluence-obsidian-publisher';
const UPGRADE_LINE = 'uv tool upgrade obx-confluence-obsidian-publisher';
const KINDS = {
  publish: { running: 'Publishing', done: 'Published to Confluence' },
  dry: { running: 'Previewing', done: 'Dry run: nothing was written' },
};

function definePlugin(ob) {
  const { Plugin, Notice, Modal, PluginSettingTab, Setting, FileSystemAdapter, MarkdownView } =
    ob;

  /** The full output of one cpub run, selectable and copyable. */
  class OutputModal extends Modal {
    constructor(app, title, text) {
      super(app);
      this.title = title;
      this.text = text;
    }

    onOpen() {
      this.titleEl.setText(this.title);
      this.contentEl.createEl('pre', { cls: 'cpub-output', text: this.text });
      new Setting(this.contentEl).addButton((b) =>
        b.setButtonText('Copy').onClick(async () => {
          await navigator.clipboard.writeText(this.text);
          new Notice('Output copied.');
        }));
    }

    onClose() {
      this.contentEl.empty();
    }
  }

  class ConfluencePublisherPlugin extends Plugin {
    async onload() {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
      this.running = false;
      this.checkedVersions = new Map();       // cpub path -> version check result
      this.ribbon = null;

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
        callback: () => this.runCheck(),
      });
      this.addSettingTab(new SettingsTab(this.app, this));
      this.updateRibbon();
    }

    async saveSettings() {
      await this.saveData(this.settings);
    }

    updateRibbon() {
      if (this.settings.showRibbon && !this.ribbon) {
        this.ribbon = this.addRibbonIcon('upload', 'Publish current note to Confluence', () => {
          const file = this.activeNote();
          if (file) this.publish(file, 'publish');
          else new Notice('Open a Markdown note to publish it to Confluence.');
        });
      } else if (!this.settings.showRibbon && this.ribbon) {
        this.ribbon.remove();
        this.ribbon = null;
      }
    }

    // -- environment --

    adapter() {
      const a = this.app.vault.adapter;
      return a instanceof FileSystemAdapter ? a : null;
    }

    activeNote() {
      const file = this.app.workspace.getActiveFile();
      return file && file.extension === 'md' && this.adapter() ? file : null;
    }

    home() {
      return require('os').homedir();
    }

    childEnv() {
      return pure.childEnv(process.env, this.home());
    }

    detectedPath() {
      const fs = require('fs');
      const exists = (p) => {
        try {
          fs.accessSync(p, fs.constants.X_OK);
          return true;
        } catch (e) {
          return false;
        }
      };
      return pure.detectCpub(this.home(), exists);
    }

    /** The cpub command to run, after the version check; null (with a notice) if unusable. */
    async cpubCommand() {
      const cmd = (this.settings.cpubPath || '').trim() || this.detectedPath();
      if (!cmd) {
        this.notice(`cpub was not found. Install it from a terminal:\n${INSTALL_LINE}\n` +
          'If it is installed somewhere else, set its path in this plugin\'s settings.', 0);
        return null;
      }
      if (!this.checkedVersions.has(cmd)) {
        const res = await this.exec(cmd, ['--version'], 15000);
        const version = res.code === 0 ? pure.parseVersion(res.stdout) : null;
        this.checkedVersions.set(cmd, version);
      }
      const version = this.checkedVersions.get(cmd);
      if (!version) {
        this.checkedVersions.delete(cmd);
        this.notice(`Could not run ${cmd}. Install cpub from a terminal:\n${INSTALL_LINE}`, 0);
        return null;
      }
      if (!pure.atLeast(version, pure.MIN_CPUB)) {
        this.checkedVersions.delete(cmd);       // re-check after the user upgrades
        this.notice(`cpub ${version} is older than ${pure.MIN_CPUB}. Update it from a ` +
          `terminal:\n${UPGRADE_LINE}`, 0);
        return null;
      }
      return cmd;
    }

    exec(cmd, args, timeoutMs, cwd) {
      return pure.runCpub(require('child_process').spawn, cmd, args, {
        cwd: cwd || this.adapter().getBasePath(),
        env: this.childEnv(),
        timeoutMs,
      });
    }

    // -- commands --

    noteCommand(checking, kind) {
      const file = this.activeNote();
      if (checking) return !!file;
      if (file) this.publish(file, kind);
      return true;
    }

    async publish(file, kind) {
      if (this.running) {
        new Notice('cpub is already running; wait for it to finish.');
        return;
      }
      this.running = true;
      let progress = null;
      try {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view && view.file === file) await view.save();     // publish what is on screen
        const cmd = await this.cpubCommand();
        if (!cmd) return;
        const adapter = this.adapter();
        const args = pure.buildArgs(kind, adapter.getFullPath(file.path));
        progress = new Notice(`${KINDS[kind].running} ${file.basename}…`, 0);
        const res = await this.exec(cmd, args, this.timeoutMs());
        progress.hide();
        progress = null;
        this.report(res, `${KINDS[kind].done}: ${file.basename}`, `cpub ${file.name}`, kind);
      } catch (e) {
        this.notice(`Could not run cpub: ${e && e.message ? e.message : e}`, 0);
      } finally {
        if (progress) progress.hide();
        this.running = false;
      }
    }

    async runCheck() {
      if (this.running) {
        new Notice('cpub is already running; wait for it to finish.');
        return;
      }
      this.running = true;
      try {
        const cmd = await this.cpubCommand();
        if (!cmd) return;
        const cwd = this.adapter() ? this.adapter().getBasePath() : this.home();
        const res = await this.exec(cmd, pure.buildArgs('check'), this.timeoutMs(), cwd);
        new OutputModal(this.app, res.code === 0 ? 'cpub check: ready' :
          'cpub check: something to fix', this.fullOutput(res)).open();
      } catch (e) {
        this.notice(`Could not run cpub: ${e && e.message ? e.message : e}`, 0);
      } finally {
        this.running = false;
      }
    }

    timeoutMs() {
      const s = Number(this.settings.timeoutSeconds);
      return (Number.isFinite(s) && s >= 10 ? s : DEFAULT_SETTINGS.timeoutSeconds) * 1000;
    }

    // -- output --

    fullOutput(res) {
      const parts = [];
      if (res.stdout) parts.push(res.stdout.trimEnd());
      if (res.stderr) parts.push(res.stderr.trimEnd());
      if (res.timedOut) parts.push(`(stopped after ${this.timeoutMs() / 1000} s)`);
      return parts.join('\n\n') || '(no output)';
    }

    /** A notice built from DOM text nodes only (never innerHTML). */
    notice(text, timeout, extra) {
      const frag = document.createDocumentFragment();
      text.split('\n').forEach((line, i) => {
        if (i) frag.appendChild(document.createElement('br'));
        frag.appendChild(document.createTextNode(line));
      });
      if (extra) extra(frag);
      return new Notice(frag, timeout === undefined ? 8000 : timeout);
    }

    report(res, headline, title, kind) {
      const s = pure.summarize(res);
      const output = this.fullOutput(res);
      const addButtons = (frag) => {
        if (s.pageUrl) {
          frag.appendChild(document.createElement('br'));
          const a = document.createElement('a');
          a.href = s.pageUrl;
          a.textContent = 'Open the page';
          frag.appendChild(a);
        }
        frag.appendChild(document.createElement('br'));
        const show = document.createElement('a');
        show.textContent = 'Show full output';
        show.href = '#';
        show.addEventListener('click', (ev) => {
          ev.preventDefault();
          new OutputModal(this.app, title, output).open();
        });
        frag.appendChild(show);
      };
      if (res.timedOut) {
        this.notice(`cpub did not finish within ${this.timeoutMs() / 1000} s and was ` +
          'stopped. Pages it had already written stay written; running it again is safe.\n' +
          'Raise the timeout in the plugin settings, or run it from a terminal.',
        0, addButtons);
      } else if (s.ok) {
        this.notice(kind === 'dry' ? `${headline}\n${s.headline || ''}`.trim() : headline,
          10000, addButtons);
      } else {
        const lines = [s.error || s.headline || `cpub failed (exit ${res.code}).`];
        if (s.fix) lines.push(`Fix: ${s.fix}`);
        this.notice(lines.join('\n'), 0, addButtons);
      }
    }
  }

  class SettingsTab extends PluginSettingTab {
    constructor(app, plugin) {
      super(app, plugin);
      this.plugin = plugin;
    }

    display() {
      const { containerEl } = this;
      const plugin = this.plugin;
      containerEl.empty();
      const detected = plugin.detectedPath();

      new Setting(containerEl)
        .setName('cpub path')
        .setDesc(detected ? `Leave empty to use the detected ${detected}.` :
          `cpub was not found in the usual places. Install it with: ${INSTALL_LINE}`)
        .addText((t) => t
          .setPlaceholder(detected || '/Users/you/.local/bin/cpub')
          .setValue(plugin.settings.cpubPath)
          .onChange(async (v) => {
            plugin.settings.cpubPath = v.trim();
            plugin.checkedVersions.clear();
            await plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('Show ribbon button')
        .setDesc('A ribbon button that publishes the current note.')
        .addToggle((t) => t
          .setValue(plugin.settings.showRibbon)
          .onChange(async (v) => {
            plugin.settings.showRibbon = v;
            plugin.updateRibbon();
            await plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('Timeout (seconds)')
        .setDesc('cpub is stopped if it takes longer than this. Rendering many diagrams ' +
          'can take a while.')
        .addText((t) => t
          .setPlaceholder(String(DEFAULT_SETTINGS.timeoutSeconds))
          .setValue(String(plugin.settings.timeoutSeconds))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 10) {
              plugin.settings.timeoutSeconds = Math.round(n);
              await plugin.saveSettings();
            }
          }));

      new Setting(containerEl)
        .setName('Check cpub setup')
        .setDesc('Runs cpub check: credentials, connection, sign-in and diagrams.')
        .addButton((b) => b.setButtonText('Run check').onClick(() => plugin.runCheck()));
    }
  }

  return ConfluencePublisherPlugin;
}

module.exports = obsidian ? definePlugin(obsidian) : {};
module.exports.pure = pure;
