// AC-G.1: the saved settings are merged with types checked, never trusted as `any`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings-data.ts';

test('missing or non-object data gives the defaults', () => {
  for (const raw of [null, undefined, 'x', 42, []]) {
    assert.deepEqual(parseSettings(raw), DEFAULT_SETTINGS);
  }
});

test('valid saved values are kept (0.1.0-0.3.0 data still loads)', () => {
  assert.deepEqual(
    parseSettings({ cpubPath: ' /u/.local/bin/cpub ', showRibbon: false, timeoutSeconds: 300 }),
    { cpubPath: '/u/.local/bin/cpub', showRibbon: false, timeoutSeconds: 300 });
});

test('wrong types, bad values and unknown keys fall back or are dropped', () => {
  const s = parseSettings({ cpubPath: 7, showRibbon: 'no', timeoutSeconds: 5, extra: true });
  assert.deepEqual(s, DEFAULT_SETTINGS);
  assert.equal(parseSettings({ timeoutSeconds: Number.NaN }).timeoutSeconds, 120);
  assert.equal(parseSettings({ timeoutSeconds: 45.6 }).timeoutSeconds, 46);
});
