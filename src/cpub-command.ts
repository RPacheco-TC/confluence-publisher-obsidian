import { accessSync, constants } from 'node:fs';
import { CpubLocator, CpubVersion, MIN_CPUB, type RunResult } from './cpub/runner.ts';
import { INSTALL_LINE, UPGRADE_LINE } from './texts.ts';

/** How the cpub command is run (``CpubRunner.run`` behind the plugin's cwd/env). */
export type Exec = (cmd: string, args: string[], timeoutMs: number) => Promise<RunResult>;

/**
 * Which cpub to run: the configured path, else the detected one; checked once per
 * path with ``cpub --version`` (>= MIN_CPUB). A failure is a notice, never a throw.
 */
export class CpubCommand {
  private readonly checked = new Map<string, string | null>();
  private readonly home: () => string;
  private readonly configured: () => string;
  private readonly exec: Exec;
  private readonly warn: (text: string) => void;

  constructor(home: () => string, configured: () => string, exec: Exec,
              warn: (text: string) => void) {
    this.home = home;
    this.configured = configured;
    this.exec = exec;
    this.warn = warn;
  }

  /** The detected cpub, from the usual install folders (no setting involved). */
  detected(): string | null {
    const exists = (p: string): boolean => {
      try {
        accessSync(p, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    };
    return new CpubLocator(this.home()).detect(exists);
  }

  /** Forget the version checks (after the path setting changes). */
  forget(): void {
    this.checked.clear();
  }

  /** The command to run, or ``null`` after a notice saying why it cannot be used. */
  async resolve(): Promise<string | null> {
    const cmd = this.configured().trim() || this.detected();
    if (!cmd) {
      this.warn(`cpub was not found. Install it from a terminal:\n${INSTALL_LINE}\n` +
        'If it is installed somewhere else, set its path in this plugin\'s settings.');
      return null;
    }
    if (!this.checked.has(cmd)) {
      const res = await this.exec(cmd, ['--version'], 15000);
      this.checked.set(cmd, res.code === 0 ? CpubVersion.parse(res.stdout) : null);
    }
    const version = this.checked.get(cmd);
    if (!version) {
      this.checked.delete(cmd);
      this.warn(`Could not run ${cmd}. Install cpub from a terminal:\n${INSTALL_LINE}`);
      return null;
    }
    if (!CpubVersion.atLeast(version, MIN_CPUB)) {
      this.checked.delete(cmd);                 // re-check after the user upgrades
      this.warn(`cpub ${version} is older than ${MIN_CPUB}. Update it from a ` +
        `terminal:\n${UPGRADE_LINE}`);
      return null;
    }
    return cmd;
  }
}
