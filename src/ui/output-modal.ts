import { Modal, Notice, Setting, type App } from 'obsidian';

/** The full output of one cpub run, selectable and copyable. */
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
    new Setting(this.contentEl).addButton((b) =>
      b.setButtonText('Copy').onClick(async () => {
        await navigator.clipboard.writeText(this.text);
        new Notice('Output copied.');
      }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
