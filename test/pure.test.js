// The PURE section of main.js: no Obsidian, no network, no real cpub.
// Run from the repo root: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pure } = require('../main.js');

const HOME = '/Users/me';
const BINS = ['/Users/me/.local/bin', '/opt/homebrew/bin', '/usr/local/bin'];

test('cpub is looked for in ~/.local/bin, Homebrew, /usr/local/bin, in that order', () => {
  assert.deepEqual(pure.cpubCandidates(HOME), BINS.map((d) => `${d}/cpub`));
  assert.equal(pure.detectCpub(HOME, (p) => p.startsWith('/opt/')), '/opt/homebrew/bin/cpub');
  assert.equal(pure.detectCpub(HOME, () => false), null);
  const exists = (p) => {
    if (p.startsWith('/Users')) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    return p.startsWith('/usr/local');
  };
  assert.equal(pure.detectCpub(HOME, exists), '/usr/local/bin/cpub');   // unreadable: skipped
});

test('the child PATH keeps the user PATH and adds the bin folders once', () => {
  const env = { PATH: '/usr/bin:/bin:/opt/homebrew/bin', HOME };
  const out = pure.childEnv(env, HOME);
  assert.equal(out.PATH, '/usr/bin:/bin:/opt/homebrew/bin:/Users/me/.local/bin:/usr/local/bin');
  assert.equal(out.HOME, HOME);
  assert.equal(env.PATH, '/usr/bin:/bin:/opt/homebrew/bin');               // not mutated
  assert.equal(pure.childEnv({}, HOME).PATH, BINS.join(':'));
});

test('arguments: publish, dry run and check; never --adopt', () => {
  assert.deepEqual(pure.buildArgs('publish', '/v/Note.md'), ['/v/Note.md']);
  assert.deepEqual(pure.buildArgs('dry', '/v/My note.md'), ['/v/My note.md', '--dry-run']);
  assert.deepEqual(pure.buildArgs('check'), ['check']);
  for (const kind of ['publish', 'dry', 'check']) {
    assert.ok(!pure.buildArgs(kind, '/v/n.md').some((a) => /adopt|yes|force/.test(a)));
  }
  assert.throws(() => pure.buildArgs('undo', '/v/n.md'), /unknown command/);
});

test('a note named like a flag can never be read as an option (absolute path only)', () => {
  for (const name of ['--adopt.md', '-x.md', '--max-updates=999.md']) {
    const args = pure.buildArgs('publish', `/vault/${name}`);
    assert.equal(args.length, 1);
    assert.ok(args[0].startsWith('/'), args[0]);
    assert.throws(() => pure.buildArgs('publish', name), /absolute/);
  }
  for (const win of ['C:\\v\\--adopt.md', 'D:/vault/-x.md', '\\\\server\\share\\--a.md']) {
    assert.deepEqual(pure.buildArgs('publish', win), [win]);       // Windows vault paths
  }
  for (const bad of ['', 'notes/a.md', './a.md', '--adopt.md', 'C:rel.md', null, undefined]) {
    assert.throws(() => pure.buildArgs('dry', bad), /absolute/);
  }
});

test('version: parsed from any --version line, compared numerically', () => {
  assert.equal(pure.parseVersion('cpub 1.4.0\n'), '1.4.0');
  assert.equal(pure.parseVersion('python3.12 -m confluence_publisher 1.10.2'), '1.10.2');
  assert.equal(pure.parseVersion('command not found'), null);
  assert.equal(pure.MIN_CPUB, '1.4.0');
  assert.ok(pure.atLeast('1.4.0', '1.4.0'));
  assert.ok(pure.atLeast('1.10.0', '1.4.0'));                              // not a string compare
  assert.ok(pure.atLeast('2.0.0', '1.4.0'));
  assert.ok(!pure.atLeast('1.3.9', '1.4.0'));
  assert.ok(!pure.atLeast(null, '1.4.0'));
});

const { EventEmitter } = require('node:events');

/** A fake child_process.spawn: the test drives the child's output and exit. */
function fakeSpawn({ throws } = {}) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    if (throws) throw Object.assign(new Error('bad'), { code: throws });
    const child = new EventEmitter();
    child.pid = 4242;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (sig) => calls.push({ childKill: sig });
    calls.push({ cmd, args, opts, child });
    fn.child = child;
    return child;
  };
  fn.calls = calls;
  return fn;
}

/** Manual timers: run them when the test says so. */
function timers() {
  const pending = [];
  return { pending,
    setTimer: (f, ms) => { const t = { f, ms }; pending.push(t); return t; },
    clearTimer: (t) => { const i = pending.indexOf(t); if (i >= 0) pending.splice(i, 1); },
    fire: () => pending.shift().f() };
}

test('runCpub: spawn with no shell, closed stdin, own group; output and exit code', async () => {
  const spawn = fakeSpawn();
  const env = { PATH: '/usr/bin' };
  const p = pure.runCpub(spawn, '/opt/homebrew/bin/cpub', ['--version'],
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
  const q = pure.runCpub(fail, 'cpub', [], { cwd: '/', env, timeoutMs: 0 });
  fail.child.stderr.emit('data', 'Error: no\nFix: yes\n');
  fail.child.emit('close', 1, null);
  assert.deepEqual([(await q).code, (await q).timedOut], [1, false]);
});

test('runCpub: a timeout stops the whole process group, then SIGKILLs it', async () => {
  const spawn = fakeSpawn(), clock = timers(), kills = [];
  const p = pure.runCpub(spawn, 'cpub', ['/v/n.md'], { cwd: '/', env: {}, timeoutMs: 120000,
    platform: 'darwin', kill: (pid, sig) => kills.push([pid, sig]), graceMs: 3000,
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
  assert.match(pure.summarize(res).error, /did not finish in time/);
});

test('runCpub: no timeout timer survives a normal exit; Windows taskkills the tree', async () => {
  const spawn = fakeSpawn(), clock = timers();
  const p = pure.runCpub(spawn, 'cpub', [], { cwd: '/', env: {}, timeoutMs: 5, platform: 'darwin',
    setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  spawn.child.emit('close', 0, null);
  await p;
  assert.deepEqual(clock.pending, []);
  const win = fakeSpawn(), wclock = timers(), taskkills = [];
  const w = pure.runCpub(win, 'cpub.exe', [], { cwd: 'C:\\', env: {}, timeoutMs: 5,
    platform: 'win32', kill: () => assert.fail('no group kill on Windows'),
    execFile: (cmd, args, opts) => taskkills.push([cmd, args, opts.shell]),
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
  const p = pure.runCpub(spawn, '/nope/cpub', [], { cwd: '/', env: {}, timeoutMs: 0 });
  spawn.child.emit('error', Object.assign(new Error('e'), { code: 'ENOENT' }));
  assert.deepEqual([(await p).code, (await p).spawnError], [null, 'ENOENT']);
  const r = await pure.runCpub(fakeSpawn({ throws: 'EACCES' }), 'x', [], { cwd: '/', env: {} });
  assert.equal(r.spawnError, 'EACCES');
});

test('summarize: success gives the page link and the headline', () => {
  const note = { code: 0, stderr: '', stdout: [
    'Replace preview:', '  Page:     Release notes  (space ENG)', '',
    '1 page published — space ENG', 'Page: https://acme.atlassian.net/wiki/spaces/ENG/pages/42',
    'History: https://acme.atlassian.net/wiki/pages/viewpreviousversions.action?pageId=42  (x)',
  ].join('\n') };
  assert.deepEqual(pure.summarize(note), { ok: true, error: null, fix: null,
    pageUrl: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/42',
    headline: '1 page published — space ENG' });
  const set = { code: 0, stderr: '', stdout:
    '\n3 pages published — space ENG, parent 10\nParent page: https://a.net/wiki/x\n' };
  assert.equal(pure.summarize(set).pageUrl, 'https://a.net/wiki/x');
  assert.equal(pure.summarize({ code: 0, stdout: '✓ Python 3.12.4\n\nAll good.\n', stderr: '' })
    .headline, 'All good.');
});

test('summarize: failures give cpub\'s Error and Fix, or say what happened', () => {
  const refused = pure.summarize({ code: 1, stdout: 'ACTION ...\n', stderr:
    'Error: 1 page needs a hand-over.\nFix: run it once from a terminal to take it over.\n' });
  assert.deepEqual([refused.ok, refused.error, refused.fix], [false,
    '1 page needs a hand-over.', 'run it once from a terminal to take it over.']);
  assert.equal(pure.summarize({ code: 2, stdout: '', stderr:
    'usage: cpub ...\ncpub: error: unrecognized arguments: -x\n' }).error,
  'unrecognized arguments: -x');
  assert.equal(pure.summarize({ code: 3, stdout: '', stderr: '' }).error,
    'cpub exited with status 3.');
  assert.match(pure.summarize({ code: null, timedOut: true, stdout: '', stderr: '' }).error,
    /did not finish in time/);
  assert.match(pure.summarize({ code: null, spawnError: 'ENOENT', stdout: '', stderr: '' })
    .error, /ENOENT/);
});
