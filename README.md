# cpub for Confluence

Publish the note you are looking at to **Confluence Cloud** with one command or hotkey.

The plugin is a thin front end for [`cpub`](https://github.com/RPacheco-TC/confluence-obsidian-publisher), a command-line tool that converts Markdown (callouts, tables, code, Mermaid diagrams, `[[links]]`) to Confluence pages and publishes them safely: every run is planned and checked before anything is written, it only updates pages it published itself, and it never deletes or moves anything.

## Requirements

- **Desktop Obsidian 1.13 or newer** (macOS, Linux, Windows). The plugin runs a program on your computer, so it does not work on mobile.
- **`cpub` 1.4.1**, the current release (1.4.0 also works). Install it once from a terminal ([uv](https://docs.astral.sh/uv/) brings its own Python):

  ```bash
  uv tool install git+https://github.com/RPacheco-TC/confluence-obsidian-publisher
  cpub setup     # asks for your Confluence site, email and API token, tests them, saves them
  ```

  The plugin finds `cpub` in `~/.local/bin`, `/opt/homebrew/bin` or `/usr/local/bin`; if yours is elsewhere, set its path in the plugin settings.

## Tell each note where it goes

Put the target page in the note's frontmatter (its Properties):

```yaml
---
confluence: https://your-company.atlassian.net/wiki/spaces/ENG/pages/123456789
---
```

- `confluence:` replaces that page's content (its title and place are kept).
- `confluence_parent:` instead creates the note as a child page of that page, and updates it on later runs.

## First publish: once, from a terminal

The first time a page is published from a note, `cpub` asks you to confirm that it may take the page over (you type the page count). The plugin cannot answer that question, and it never forces a take-over, so do the first publish of each page from a terminal:

```bash
cpub "/path/to/vault/My Note.md"
```

After that the page is marked as published from that note, and the plugin updates it with no question. If you skip this step, the plugin shows `cpub`'s message telling you to run it once from a terminal; nothing is written.

## Commands

Bind any of them to a key in **Settings → Hotkeys** (search "Confluence"):

| Command | What it runs |
| --- | --- |
| **Publish current note to Confluence** | `cpub <note>` |
| **Preview publish (dry run)** | `cpub <note> --dry-run`: shows what would happen, writes nothing |
| **Check cpub setup** | `cpub check`: Python, credentials, connection, sign-in, diagrams |

An optional ribbon button runs **Publish**. The note is saved first. When `cpub` finishes, a notice shows the page link, or `cpub`'s `Error:` and `Fix:` lines; **Show full output** opens everything `cpub` printed, as selectable text. A run that takes longer than the timeout (default 120 seconds, in the settings) is stopped.

Undo is not in the plugin: `cpub undo` always asks for confirmation, so run it from a terminal.

## Privacy and safety

- **The plugin never reads, stores or sends your Confluence credentials** and makes **no network requests** itself. Only `cpub` talks to Confluence, with the credentials `cpub setup` saved on your computer.
- **It runs one external program, `cpub`.** That is what the plugin is for, and why Obsidian's review flags it. It starts `cpub` directly with Node's `child_process` and `shell: false`, never through a shell, so a note name is passed as one argument and never interpreted as a command.
- It never passes `--adopt` or any other flag that would let it take over a page `cpub` did not publish.

## What this plugin accesses

- **Programs:** it runs only `cpub` (the path you set, or the first of `~/.local/bin/cpub`, `/opt/homebrew/bin/cpub`, `/usr/local/bin/cpub` that answers `cpub --version`), directly with Node's `child_process`, **never through a shell**. Arguments are the note's absolute path and, for a preview, `--dry-run`, or `check`. Never `--adopt`, never `undo`.
- **Network:** none. The plugin makes no requests; only `cpub` talks to Confluence.
- **Credentials:** none. The plugin never reads, stores or sends them; `cpub` keeps its own.
- **Files:** none of its own. It saves the open note through Obsidian before publishing, and stores its three settings with Obsidian's plugin data.
- **Clipboard:** none. The output window shows selectable text; copy it yourself if you need it.

## Settings

- **cpub path**: empty means auto-detect.
- **Show ribbon button**.
- **Timeout (seconds)**.
- **Detect cpub**: looks for `cpub` again and shows what it found under *cpub path*.
- **Check cpub setup**: the same as the *Check cpub setup* command.

## Upgrading

- **From 0.3.1:** 0.3.2 needs Obsidian 1.13 or newer (older apps keep 0.3.1). The output window has no **Copy** button any more: select the text instead. If `cpub` was installed before 1.4.1, its package was renamed, so reinstall it once: `uv tool uninstall obx-confluence-obsidian-publisher`, then `uv tool install git+https://github.com/RPacheco-TC/confluence-obsidian-publisher` (pipx: `pipx uninstall obx-confluence-obsidian-publisher`, then `pipx install git+…`). Your credentials, log and pages are kept.
- **From 0.3.0:** the *Check cpub setup* command has a new id (`check-setup`), so a hotkey bound to it must be bound again. Publish and Preview keep theirs.
- **From 0.1 or 0.2:** see below.

### Upgrading from 0.1 or 0.2

Until 0.3.0 the plugin was called "Confluence Publisher", with the id `confluence-publisher`. Obsidian keeps hotkeys and settings per plugin id, so 0.3.0 is a new plugin to it: remove the old `<vault>/.obsidian/plugins/confluence-publisher/` folder, install 0.3.0 into `plugins/cpub/`, then bind your hotkeys again (the commands have the same names) and re-enter the **cpub path** if you had set one.

## Development

The plugin is written in TypeScript (`src/`) and bundled into `main.js` with esbuild; `main.js` is a build artifact, attached to each release and not kept in git. The only dependencies are development tools, pinned to exact versions; the plugin itself has no runtime dependencies.

```bash
npm ci              # install the pinned dev tools
npm run build       # src/main.ts -> main.js
npm run typecheck   # tsc --noEmit (strict)
npm test            # node --test on the .ts sources (Node 23.6+ strips the types)
```

To try a build, copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/cpub/` and reload Obsidian.

## License

MIT
