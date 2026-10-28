// Everything cpub-specific that needs no Obsidian: where cpub is, the PATH it runs
// with, its arguments, its version, and running it. Node built-ins only; no
// network, no credentials. Tested by test/runner.test.ts with node --test.
import * as path from 'node:path';
import { execFile as nodeExecFile } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';

export const MIN_CPUB = '1.4.0';
export const KILL_GRACE_MS = 3000;
/** How long one `<candidate> --version` probe may take while looking for cpub. */
export const FIND_TIMEOUT_MS = 15000;
const OUTPUT_LIMIT = 16 * 1024 * 1024;

export type CommandKind = 'publish' | 'dry' | 'check';

/** What one cpub run gave; always produced, never thrown. */
export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError: string | null;
}

interface EmitterLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

/** The part of a ChildProcess the runner uses (tests pass a fake). */
export interface ChildLike extends EmitterLike {
  pid?: number;
  stdout: EmitterLike | null;
  stderr: EmitterLike | null;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export type SpawnFn = (cmd: string, args: readonly string[], opts: SpawnOptions) => ChildLike;
export type ExecFileFn = (file: string, args: readonly string[], opts: object,
  callback: (error: Error | null) => void) => unknown;

/** A cpub found by {@link CpubLocator.find}: its path and what `--version` said. */
export interface FoundCpub {
  path: string;
  result: RunResult;
  /** null when `--version` failed or printed no x.y.z (a broken install). */
  version: string | null;
}

/** Where cpub is looked for, and the PATH it is started with. */
export class CpubLocator {
  readonly home: string;

  constructor(home: string) {
    this.home = home;
  }

  /** uv/pipx (~/.local/bin), Homebrew, /usr/local/bin: Obsidian's own PATH is minimal. */
  binDirs(): string[] {
    return [path.join(this.home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  }

  candidates(): string[] {
    return this.binDirs().map((dir) => path.join(dir, 'cpub'));
  }

  /**
   * The first candidate that starts, found by running `<candidate> --version`
   * (no shell, no filesystem access): a spawn error (ENOENT, EACCES, ...) means "not
   * here", so the next one is tried. A candidate that starts but fails still wins,
   * with version null, so the caller can say it is broken. null when none starts.
   */
  async find(runner: CpubRunner, opts: RunOptions): Promise<FoundCpub | null> {
    for (const candidate of this.candidates()) {
      const result = await runner.run(candidate, ['--version'],
        { timeoutMs: FIND_TIMEOUT_MS, ...opts });
      if (result.spawnError) continue;
      const version = result.code === 0 ? CpubVersion.parse(result.stdout) : null;
      return { path: candidate, result, version };
    }
    return null;
  }

  /** A copy of `env` whose PATH also holds the bin folders (npx needs node). */
  childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const parts = String(env.PATH ?? '').split(path.delimiter).filter(Boolean);
    for (const dir of this.binDirs()) if (!parts.includes(dir)) parts.push(dir);
    return { ...env, PATH: parts.join(path.delimiter) };
  }
}

/** cpub's arguments: never --adopt, undo or any write-forcing flag. */
export class CpubArgs {
  /** An absolute path on macOS/Linux ('/...') or Windows ('C:\\...'); never '-...'. */
  static isAbsolutePath(p: unknown): p is string {
    return typeof p === 'string' && !p.startsWith('-') &&
      (path.posix.isAbsolute(p) || path.win32.isAbsolute(p));
  }

  /** The note path must be absolute, so a note named '--adopt.md' is never an option. */
  static build(kind: CommandKind, notePath?: string): string[] {
    if (kind === 'check') return ['check'];
    if (kind !== 'publish' && kind !== 'dry') throw new Error(`unknown command ${String(kind)}`);
    if (!CpubArgs.isAbsolutePath(notePath)) throw new Error('the note path must be absolute');
    return kind === 'dry' ? [notePath, '--dry-run'] : [notePath];
  }
}

/** cpub --version, and the minimum this plugin needs. */
export class CpubVersion {
  /** 'cpub 1.4.0' -> '1.4.0'; null when there is no x.y.z in it. */
  static parse(stdout: string | null | undefined): string | null {
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(stdout ?? ''));
    return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
  }

  /** Whether `v` (x.y.z) is at least `min`, compared numerically; false for null. */
  static atLeast(v: string | null, min: string = MIN_CPUB): boolean {
    if (!v) return false;
    const a = v.split('.').map(Number), b = min.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0);
    return true;
  }
}

/**
 * What the runner needs from its host. The timers are required: the plugin passes
 * window.setTimeout / window.clearTimeout, the tests pass Node's (or manual ones).
 */
export interface RunnerDeps {
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  platform?: NodeJS.Platform;
  execFile?: ExecFileFn;
  graceMs?: number;
}

export interface RunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/**
 * Runs cpub through an injected spawn: no shell, ever; stdin closed, so cpub can
 * never wait for a prompt. cpub starts in its own process group, so a timeout stops
 * it AND its children (npx, node, the headless browser that renders diagrams):
 * SIGTERM to the group, then SIGKILL after a grace period (on Windows, which has no
 * process groups: `taskkill /pid <pid> /T /F`, no shell). Always resolves.
 */
export class CpubRunner {
  readonly spawn: SpawnFn;
  readonly deps: RunnerDeps;

  constructor(spawn: SpawnFn, deps: RunnerDeps) {
    this.spawn = spawn;
    this.deps = deps;
  }

  run(cmd: string, args: readonly string[], opts: RunOptions): Promise<RunResult> {
    const d = this.deps;
    const kill = d.kill ?? ((pid: number, sig: NodeJS.Signals) => { process.kill(pid, sig); });
    const platform = d.platform ?? process.platform;
    const graceMs = d.graceMs ?? KILL_GRACE_MS;
    const { setTimer, clearTimer } = d;
    return new Promise((resolve) => {
      const out: RunResult = { code: null, stdout: '', stderr: '', timedOut: false,
        spawnError: null };
      let child: ChildLike;
      let done = false, timer: unknown = null, killTimer: unknown = null;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimer(timer);
        // after a timeout the group SIGKILL still fires: a child that ignored SIGTERM
        // must not outlive cpub (killing a group that is gone is harmless)
        if (!out.timedOut) clearTimer(killTimer);
        resolve(out);
      };
      const stop = (signal: NodeJS.Signals): void => {
        try {
          if (platform !== 'win32') {
            kill(-(child.pid ?? 0), signal);                     // the whole group
          } else if (signal === 'SIGTERM') {                     // no groups: the tree
            const execFile = d.execFile ?? defaultExecFile;
            execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'],
              { shell: false, windowsHide: true }, () => {});
          } else {
            child.kill(signal);                                  // last resort
          }
        } catch {
          /* already gone */
        }
      };
      try {
        child = this.spawn(cmd, args, { cwd: opts.cwd, env: opts.env, shell: false,
          detached: platform !== 'win32', windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        out.spawnError = errorCode(e);
        finish();
        return;
      }
      const collect = (key: 'stdout' | 'stderr') => (chunk: unknown): void => {
        if (out[key].length < OUTPUT_LIMIT) out[key] += String(chunk);
      };
      child.stdout?.on('data', collect('stdout'));
      child.stderr?.on('data', collect('stderr'));
      child.on('error', (e: unknown) => {                        // e.g. ENOENT: wrong path
        out.spawnError = errorCode(e);
        finish();
      });
      child.on('close', (code: unknown) => {
        out.code = typeof code === 'number' && !out.timedOut ? code : null;
        finish();
      });
      if (opts.timeoutMs) {
        timer = setTimer(() => {
          out.timedOut = true;
          stop('SIGTERM');
          killTimer = setTimer(() => stop('SIGKILL'), graceMs);
        }, opts.timeoutMs);
      }
    });
  }
}

function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : String(e);
}

/** child_process.execFile, for the Windows taskkill only. */
const defaultExecFile: ExecFileFn = (file, args, opts, callback) =>
  nodeExecFile(file, [...args], opts, (error) => callback(error));
