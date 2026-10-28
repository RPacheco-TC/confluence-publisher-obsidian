// Fixed wording shared by the plugin's files.

export const INSTALL_LINE =
  'uv tool install git+https://github.com/RPacheco-TC/confluence-obsidian-publisher';
/**
 * Only a cpub older than 1.4.0 triggers this, and every such install has the package's
 * old name (renamed in 1.4.1): an upgrade by the new name fails, and --force installs
 * it beside the old one. So: uninstall the old package, then install the new one.
 */
export const UPGRADE_LINE =
  `uv tool uninstall obx-confluence-obsidian-publisher\n${INSTALL_LINE}`;

/** The two note commands' progress and success wording. */
export const KINDS = {
  publish: { running: 'Publishing', done: 'Published to Confluence' },
  dry: { running: 'Previewing', done: 'Dry run: nothing was written' },
} as const;

export type NoteKind = keyof typeof KINDS;
