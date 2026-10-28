import { Notice, type App } from 'obsidian';
import { CpubResult } from '../cpub/result.ts';
import type { RunResult } from '../cpub/runner.ts';
import type { NoteKind } from '../texts.ts';
import { OutputModal } from './output-modal.ts';

type Extra = (frag: DocumentFragment) => void;

/**
 * Every message the plugin shows. Notices are built from DOM text nodes only,
 * never innerHTML (D32).
 */
export class Notifier {
  private readonly app: App;
  private readonly timeoutMs: () => number;

  constructor(app: App, timeoutMs: () => number) {
    this.app = app;
    this.timeoutMs = timeoutMs;
  }

  /** One line per "\n"; ``timeout`` 0 keeps it until clicked (default 8 s). */
  message(text: string, timeout = 8000, extra?: Extra): Notice {
    const frag = document.createDocumentFragment();
    text.split('\n').forEach((line, i) => {
      if (i) frag.appendChild(document.createElement('br'));
      frag.appendChild(document.createTextNode(line));
    });
    if (extra) extra(frag);
    return new Notice(frag, timeout);
  }

  /** Everything cpub printed, for the "Show full output" modal. */
  fullOutput(res: RunResult): string {
    const parts: string[] = [];
    if (res.stdout) parts.push(res.stdout.trimEnd());
    if (res.stderr) parts.push(res.stderr.trimEnd());
    if (res.timedOut) parts.push(`(stopped after ${this.timeoutMs() / 1000} s)`);
    return parts.join('\n\n') || '(no output)';
  }

  showOutput(heading: string, res: RunResult): void {
    new OutputModal(this.app, heading, this.fullOutput(res)).open();
  }

  /** The result of a publish or a dry run: page link, or cpub's Error + Fix. */
  report(res: RunResult, headline: string, title: string, kind: NoteKind): void {
    const s = CpubResult.summarize(res);
    const output = this.fullOutput(res);
    const addLinks: Extra = (frag) => {
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
      this.message(`cpub did not finish within ${this.timeoutMs() / 1000} s and was ` +
        'stopped. Pages it had already written stay written; running it again is safe.\n' +
        'Raise the timeout in the plugin settings, or run it from a terminal.', 0, addLinks);
    } else if (s.ok) {
      this.message(kind === 'dry' ? `${headline}\n${s.headline || ''}`.trim() : headline,
        10000, addLinks);
    } else {
      const lines = [s.error || s.headline || `cpub failed (exit ${res.code}).`];
      if (s.fix) lines.push(`Fix: ${s.fix}`);
      this.message(lines.join('\n'), 0, addLinks);
    }
  }
}
