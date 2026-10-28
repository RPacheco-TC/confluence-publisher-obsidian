// What a cpub run means, from its exit code and output. No Obsidian, no I/O.
import type { RunResult } from './runner.ts';

export type { RunResult } from './runner.ts';

export interface Summary {
  ok: boolean;
  pageUrl: string | null;
  error: string | null;
  fix: string | null;
  headline: string | null;
}

/** Reads cpub's output: the page link, the headline and its Error:/Fix: lines. */
export class CpubResult {
  /**
   * pageUrl comes from a 'Page: <url>' or 'Parent page: <url>' line at the start of
   * a line (the replace preview's indented '  Page:     <title>' is not one).
   */
  static summarize(result: RunResult): Summary {
    const all = `${result.stdout || ''}\n${result.stderr || ''}`;
    const pageUrl = CpubResult.firstMatch(all, /^(?:Parent page|Page): (https?:\/\/\S+)\s*$/);
    const lines = String(result.stdout || '').split(/\r?\n/).map((l) => l.trim())
      .filter(Boolean);
    const headline = lines.find((l) => /^\d+ pages? .+ — space /.test(l)) ??
      lines[lines.length - 1] ?? null;
    let error = CpubResult.firstMatch(all, /^Error: (.+)$/);
    const fix = CpubResult.firstMatch(all, /^Fix: (.+)$/);
    if (result.timedOut) error = 'cpub did not finish in time and was stopped.';
    else if (result.spawnError) error = `cpub could not be started (${result.spawnError}).`;
    else if (!error && result.code) {
      error = CpubResult.firstMatch(all, /^\S+: error: (.+)$/) ??
        `cpub exited with status ${result.code}.`;
    }
    const ok = result.code === 0 && !result.timedOut && !result.spawnError;
    return { ok, pageUrl, error: ok ? null : error, fix: ok ? null : fix, headline };
  }

  /** The first capture of `re` on any line of `text`, trimmed; null when none. */
  static firstMatch(text: string, re: RegExp): string | null {
    for (const line of text.split(/\r?\n/)) {
      const m = re.exec(line);
      if (m && m[1] !== undefined) return m[1].trim();
    }
    return null;
  }
}
