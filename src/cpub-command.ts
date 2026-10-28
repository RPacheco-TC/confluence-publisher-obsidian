import { CpubVersion, MIN_CPUB, type FoundCpub, type RunResult } from './cpub/runner.ts';
import { INSTALL_LINE, UPGRADE_LINE } from './texts.ts';

/** How the cpub command is run (``CpubRunner.run`` behind the plugin's cwd/env). */
export type Exec = (cmd: string, args: string[], timeoutMs: number) => Promise<RunResult>;
/** Detection: ``CpubLocator.find`` (runs ``<candidate> --version``; no filesystem access). */
export type Find = () => Promise<FoundCpub | null>;

/**
 * Which cpub to run: the configured path, else the detected one; checked once per
 * path with ``cpub --version`` (>= MIN_CPUB). A failure is a notice, never a throw.
 * Detection runs cpub, so it happens on first use (never at startup) and is cached.
 */
export class CpubCommand {
  private readonly checked = new Map<string, string | null>();
  private found: string | null | undefined = undefined;
  private readonly configured: () => string;
  private readonly exec: Exec;
  private readonly find: Find;
  private readonly warn: (text: string) => void;
  private readonly onDetected: () => void;

  constructor(configured: () => string, exec: Exec, find: Find, warn: (text: string) => void,
              onDetected: () => void = () => {}) {
    this.configured = configured;
    this.exec = exec;
    this.find = find;
    this.warn = warn;
    this.onDetected = onDetected;
  }

  /** The last detection: a path, null (not found) or undefined (not run yet). */
  detected(): string | null | undefined {
    return this.found;
  }

  /** Look for cpub in the usual folders now; the version found is cached too. */
  async detect(): Promise<string | null> {
    const hit = await this.find();
    this.found = hit ? hit.path : null;
    if (hit) this.checked.set(hit.path, hit.version);
    this.onDetected();
    return this.found;
  }

  /** Forget the version checks (after the path setting changes). */
  forget(): void {
    this.checked.clear();
  }

  /** The command to run, or ``null`` after a notice saying why it cannot be used. */
  async resolve(): Promise<string | null> {
    const configured = this.configured().trim();
    let cmd: string | null = configured;
    if (!cmd) {
      cmd = typeof this.found === 'string' && this.checked.has(this.found)
        ? this.found : await this.detect();
    }
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
