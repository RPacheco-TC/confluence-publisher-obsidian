// Fixed wording shared by the plugin's files (unchanged from 0.1.0).

export const INSTALL_LINE =
  'uv tool install git+https://github.com/RPacheco-TC/obx-confluence-obsidian-publisher';
export const UPGRADE_LINE = 'uv tool upgrade obx-confluence-obsidian-publisher';

/** The two note commands' progress and success wording. */
export const KINDS = {
  publish: { running: 'Publishing', done: 'Published to Confluence' },
  dry: { running: 'Previewing', done: 'Dry run: nothing was written' },
} as const;

export type NoteKind = keyof typeof KINDS;
