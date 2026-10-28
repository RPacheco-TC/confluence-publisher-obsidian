import { Modal, type App } from 'obsidian';

/** The full output of one cpub run; the text is selectable (no clipboard access). */
export class OutputModal extends Modal {
  private readonly heading: string;
  private readonly text: string;

  constructor(app: App, heading: string, text: string) {
    super(app);
    this.heading = heading;
    this.text = text;
  }

  onOpen(): void {
    this.titleEl.setText(this.heading);
    this.contentEl.createEl('pre', { cls: 'cpub-output', text: this.text });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
