// cpub/result.ts: what a cpub run means. Run from the repo root: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { CpubResult } from '../src/cpub/result.ts';
import type { RunResult } from '../src/cpub/runner.ts';

/** summarize() over a run result with defaults, so each case states only what matters. */
const summarize = (r: Partial<RunResult>) => CpubResult.summarize(
  { code: 0, stdout: '', stderr: '', timedOut: false, spawnError: null, ...r });

test('summarize: success gives the page link and the headline', () => {
  const note = { code: 0, stderr: '', stdout: [
    'Replace preview:', '  Page:     Release notes  (space ENG)', '',
    '1 page published — space ENG', 'Page: https://acme.atlassian.net/wiki/spaces/ENG/pages/42',
    'History: https://acme.atlassian.net/wiki/pages/viewpreviousversions.action?pageId=42  (x)',
  ].join('\n') };
  assert.deepEqual(summarize(note), { ok: true, error: null, fix: null,
    pageUrl: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/42',
    headline: '1 page published — space ENG' });
  const set = { code: 0, stderr: '', stdout:
    '\n3 pages published — space ENG, parent 10\nParent page: https://a.net/wiki/x\n' };
  assert.equal(summarize(set).pageUrl, 'https://a.net/wiki/x');
  assert.equal(summarize({ code: 0, stdout: '✓ Python 3.12.4\n\nAll good.\n', stderr: '' })
    .headline, 'All good.');
});

test('summarize: failures give cpub\'s Error and Fix, or say what happened', () => {
  const refused = summarize({ code: 1, stdout: 'ACTION ...\n', stderr:
    'Error: 1 page needs a hand-over.\nFix: run it once from a terminal to take it over.\n' });
  assert.deepEqual([refused.ok, refused.error, refused.fix], [false,
    '1 page needs a hand-over.', 'run it once from a terminal to take it over.']);
  assert.equal(summarize({ code: 2, stdout: '', stderr:
    'usage: cpub ...\ncpub: error: unrecognized arguments: -x\n' }).error,
  'unrecognized arguments: -x');
  assert.equal(summarize({ code: 3, stdout: '', stderr: '' }).error,
    'cpub exited with status 3.');
  assert.match(String(summarize({ code: null, timedOut: true, stdout: '', stderr: '' }).error),
    /did not finish in time/);
  assert.match(String(summarize({ code: null, spawnError: 'ENOENT', stdout: '', stderr: '' })
    .error), /ENOENT/);
});
