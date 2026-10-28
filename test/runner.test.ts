// cpub/runner.ts: where cpub is, its PATH, arguments, version, and running it.
// No Obsidian, no network, no real cpub. Run from the repo root: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CpubArgs, CpubLocator, CpubRunner, CpubVersion, MIN_CPUB } from '../src/cpub/runner.ts';
import type { RunnerDeps, RunResult, SpawnFn } from '../src/cpub/runner.ts';
import { CpubResult } from '../src/cpub/result.ts';

/** Node's timers: what the tests inject where the plugin passes window's (G.2). */
const NODE_TIMERS: RunnerDeps = {
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
};

type RunOpts = { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number } & Partial<RunnerDeps>;

/** The 0.1.0 call shape, kept so every ported assertion reads as before. */
function runCpub(spawn: SpawnFn, cmd: string, args: string[], opts: RunOpts): Promise<RunResult> {
  const { cwd, env, timeoutMs, ...deps } = opts;
  return new CpubRunner(spawn, { ...NODE_TIMERS, ...deps }).run(cmd, args, { cwd, env, timeoutMs });
}

/** A spawn whose children answer by path: 'ok' prints a version, 'fail' exits 1,
 * anything else is a spawn error with that code (ENOENT, EACCES, ...). */
function scriptedSpawn(answers: Record<string, string>): SpawnFn & { seen: string[] } {
  const seen: string[] = [];
  const fn = ((cmd: string) => {
    seen.push(cmd);
    const child = new FakeChild([]);
    const answer = answers[cmd] ?? 'ENOENT';
    setImmediate(() => {
      if (answer === 'ok') {
        child.stdout.emit('data', 'cpub 1.4.0\n');
        child.emit('close', 0, null);
      } else if (answer === 'fail') {
        child.emit('close', 1, null);
      } else {
        child.emit('error', Object.assign(new Error(answer), { code: answer }));
      }
    });
    return child;
  }) as unknown as SpawnFn & { seen: string[] };
  fn.seen = seen;
  return fn;
}

const HOME = '/Users/me';
const BINS = ['/Users/me/.local/bin', '/opt/homebrew/bin', '/usr/local/bin'];

test('cpub is looked for in ~/.local/bin, Homebrew, /usr/local/bin, in that order', async () => {
  assert.deepEqual(new CpubLocator(HOME).candidates(), BINS.map((d) => `${d}/cpub`));
  const locator = new CpubLocator(HOME);
  const find = (answers: Record<string, string>) => {
    const spawn = scriptedSpawn(answers);
    return locator.find(new CpubRunner(spawn, NODE_TIMERS), { cwd: '/', env: {} })
      .then((found) => ({ found, seen: spawn.seen }));
  };
  const opt = await find({ '/opt/homebrew/bin/cpub': 'ok' });     // probed with --version
  assert.equal(opt.found?.path, '/opt/homebrew/bin/cpub');
  assert.equal(opt.found?.version, '1.4.0');
  assert.deepEqual(opt.seen, ['/Users/me/.local/bin/cpub', '/opt/homebrew/bin/cpub']);
  assert.equal((await find({})).found, null);                     // none starts
  const skipped = await find({ '/Users/me/.local/bin/cpub': 'EACCES',
    '/opt/homebrew/bin/cpub': 'ENOTDIR', '/usr/local/bin/cpub': 'ok' });
  assert.equal(skipped.found?.path, '/usr/local/bin/cpub');       // unreadable: skipped
  const broken = await find({ '/Users/me/.local/bin/cpub': 'fail' });
  assert.deepEqual([broken.found?.path, broken.found?.version],   // starts but fails: found,
    ['/Users/me/.local/bin/cpub', null]);                         // reported as broken
});

test('the child PATH keeps the user PATH and adds the bin folders once', () => {
  const env = { PATH: '/usr/bin:/bin:/opt/homebrew/bin', HOME };
  const out = new CpubLocator(HOME).childEnv(env);
  assert.equal(out.PATH, '/usr/bin:/bin:/opt/homebrew/bin:/Users/me/.local/bin:/usr/local/bin');
  assert.equal(out.HOME, HOME);
  assert.equal(env.PATH, '/usr/bin:/bin:/opt/homebrew/bin');               // not mutated
  assert.equal(new CpubLocator(HOME).childEnv({}).PATH, BINS.join(':'));
});

test('arguments: publish, dry run and check; never --adopt', () => {
  assert.deepEqual(CpubArgs.build('publish', '/v/Note.md'), ['/v/Note.md']);
  assert.deepEqual(CpubArgs.build('dry', '/v/My note.md'), ['/v/My note.md', '--dry-run']);
  assert.deepEqual(CpubArgs.build('check'), ['check']);
  for (const kind of ['publish', 'dry', 'check'] as const) {
    assert.ok(!CpubArgs.build(kind, '/v/n.md').some((a) => /adopt|yes|force/.test(a)));
  }
  assert.throws(() => CpubArgs.build('undo' as never, '/v/n.md'), /unknown command/);
});

test('a note named like a flag can never be read as an option (absolute path only)', () => {
  for (const name of ['--adopt.md', '-x.md', '--max-updates=999.md']) {
    const args = CpubArgs.build('publish', `/vault/${name}`);
    assert.equal(args.length, 1);
    assert.ok(args[0].startsWith('/'), args[0]);
    assert.throws(() => CpubArgs.build('publish', name), /absolute/);
  }
  for (const win of ['C:\\v\\--adopt.md', 'D:/vault/-x.md', '\\\\server\\share\\--a.md']) {
    assert.deepEqual(CpubArgs.build('publish', win), [win]);       // Windows vault paths
  }
  for (const bad of ['', 'notes/a.md', './a.md', '--adopt.md', 'C:rel.md', null, undefined]) {
    assert.throws(() => CpubArgs.build('dry', bad as string), /absolute/);
  }
});

test('version: parsed from any --version line, compared numerically', () => {
  assert.equal(CpubVersion.parse('cpub 1.4.0\n'), '1.4.0');
  assert.equal(CpubVersion.parse('python3.12 -m confluence_publisher 1.10.2'), '1.10.2');
  assert.equal(CpubVersion.parse('command not found'), null);
  assert.equal(MIN_CPUB, '1.4.0');
  assert.ok(CpubVersion.atLeast('1.4.0', '1.4.0'));
  assert.ok(CpubVersion.atLeast('1.10.0', '1.4.0'));                // not a string compare
  assert.ok(CpubVersion.atLeast('2.0.0', '1.4.0'));
  assert.ok(!CpubVersion.atLeast('1.3.9', '1.4.0'));
  assert.ok(!CpubVersion.atLeast(null, '1.4.0'));
});

/** A child the test drives: it emits the output and the exit itself. */
class FakeChild extends EventEmitter {
  pid = 4242;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  calls: unknown[];

  constructor(calls: unknown[]) {
    super();
    this.calls = calls;
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.calls.push({ childKill: signal });
    return true;
  }
}

type FakeSpawn = SpawnFn & { calls: any[]; child: FakeChild };

/** A fake child_process.spawn that records its calls. */
function fakeSpawn({ throws }: { throws?: string } = {}): FakeSpawn {
  const calls: any[] = [];
  const fn = ((cmd: string, args: readonly string[], opts: unknown) => {
    if (throws) throw Object.assign(new Error('bad'), { code: throws });
    const child = new FakeChild(calls);
    calls.push({ cmd, args, opts, child });
    fn.child = child;
    return child;
  }) as unknown as FakeSpawn;
  fn.calls = calls;
  return fn;
}

/** Manual timers: run them when the test says so. */
interface Timer { f: () => void; ms: number }

function timers() {
  const pending: Timer[] = [];
  return { pending,
    setTimer: (f: () => void, ms: number) => { const t = { f, ms }; pending.push(t); return t; },
    clearTimer: (t: unknown) => {
      const i = pending.indexOf(t as Timer);
      if (i >= 0) pending.splice(i, 1);
    },
    fire: () => pending.shift()?.f() };
}

test('runCpub: spawn with no shell, closed stdin, own group; output and exit code', async () => {
  const spawn = fakeSpawn();
  const env = { PATH: '/usr/bin' };
  const p = runCpub(spawn, '/opt/homebrew/bin/cpub', ['--version'],
    { cwd: '/vault', env, timeoutMs: 120000, platform: 'darwin' });
  spawn.child.stdout.emit('data', Buffer.from('cpub 1.4.0\n'));
  spawn.child.stderr.emit('data', 'warn\n');
  spawn.child.emit('close', 0, null);
  assert.deepEqual(await p, { code: 0, stdout: 'cpub 1.4.0\n', stderr: 'warn\n',
    timedOut: false, spawnError: null });
  const { cmd, args, opts } = spawn.calls[0];
  assert.deepEqual([cmd, args], ['/opt/homebrew/bin/cpub', ['--version']]);
  assert.equal(opts.shell, false);
  assert.equal(opts.detached, true);
  assert.deepEqual(opts.stdio, ['ignore', 'pipe', 'pipe']);
  assert.deepEqual([opts.cwd, opts.env], ['/vault', env]);

  const fail = fakeSpawn();
  const q = runCpub(fail, 'cpub', [], { cwd: '/', env, timeoutMs: 0 });
  fail.child.stderr.emit('data', 'Error: no\nFix: yes\n');
  fail.child.emit('close', 1, null);
  assert.deepEqual([(await q).code, (await q).timedOut], [1, false]);
});

test('runCpub: a timeout stops the whole process group, then SIGKILLs it', async () => {
  const spawn = fakeSpawn(), clock = timers(), kills: [number, string][] = [];
  const p = runCpub(spawn, 'cpub', ['/v/n.md'], { cwd: '/', env: {}, timeoutMs: 120000,
    platform: 'darwin', graceMs: 3000,
    kill: (pid, sig) => { kills.push([pid, sig]); },
    setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  assert.deepEqual(clock.pending.map((t) => t.ms), [120000]);
  clock.fire();                                            // the timeout
  assert.deepEqual(kills, [[-4242, 'SIGTERM']]);           // negative pid: the group
  spawn.child.emit('close', null, 'SIGTERM');              // cpub itself is gone...
  const res = await p;
  assert.deepEqual([res.timedOut, res.code], [true, null]);
  assert.deepEqual(clock.pending.map((t) => t.ms), [3000]); // ...the group SIGKILL still runs
  clock.fire();
  assert.deepEqual(kills, [[-4242, 'SIGTERM'], [-4242, 'SIGKILL']]);
  assert.match(String(CpubResult.summarize(res).error), /did not finish in time/);
});

test('runCpub: no timeout timer survives a normal exit; Windows taskkills the tree', async () => {
  const spawn = fakeSpawn(), clock = timers();
  const p = runCpub(spawn, 'cpub', [], { cwd: '/', env: {}, timeoutMs: 5, platform: 'darwin',
    setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  spawn.child.emit('close', 0, null);
  await p;
  assert.deepEqual(clock.pending, []);
  const win = fakeSpawn(), wclock = timers(), taskkills: unknown[] = [];
  const w = runCpub(win, 'cpub.exe', [], { cwd: 'C:\\', env: {}, timeoutMs: 5,
    platform: 'win32', kill: () => assert.fail('no group kill on Windows'),
    execFile: (cmd, args, opts) => taskkills.push([cmd, args, (opts as { shell?: boolean }).shell]),
    setTimer: wclock.setTimer, clearTimer: wclock.clearTimer });
  assert.equal(win.calls[0].opts.detached, false);           // no new console window
  wclock.fire();
  assert.deepEqual(taskkills, [['taskkill', ['/pid', '4242', '/T', '/F'], false]]);
  win.child.emit('close', null, 'SIGTERM');
  assert.equal((await w).timedOut, true);
  wclock.fire();                                             // grace: last-resort child kill
  assert.deepEqual(win.calls[1], { childKill: 'SIGKILL' });
});

test('runCpub: a wrong path is reported, never thrown', async () => {
  const spawn = fakeSpawn();
  const p = runCpub(spawn, '/nope/cpub', [], { cwd: '/', env: {}, timeoutMs: 0 });
  spawn.child.emit('error', Object.assign(new Error('e'), { code: 'ENOENT' }));
  assert.deepEqual([(await p).code, (await p).spawnError], [null, 'ENOENT']);
  const r = await runCpub(fakeSpawn({ throws: 'EACCES' }), 'x', [], { cwd: '/', env: {} });
  assert.equal(r.spawnError, 'EACCES');
});

