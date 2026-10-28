# Confluence Publisher

Publish the note you are looking at to **Confluence Cloud** with one command or hotkey.

The plugin is a thin front end for [`cpub`](https://github.com/RPacheco-TC/obx-confluence-obsidian-publisher), a command-line tool that converts Markdown (callouts, tables, code, Mermaid diagrams, `[[links]]`) to Confluence pages and publishes them safely: every run is planned and checked before anything is written, it only updates pages it published itself, and it never deletes or moves anything.

## Requirements

- **Desktop Obsidian** (macOS, Linux, Windows). The plugin runs a program on your computer, so it does not work on mobile.
- **`cpub` 1.4.0 or newer.** Install it once from a terminal ([uv](https://docs.astral.sh/uv/) brings its own Python):

  ```bash
  uv tool install git+https://github.com/RPacheco-TC/obx-confluence-obsidian-publisher
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

An optional ribbon button runs **Publish**. The note is saved first. When `cpub` finishes, a notice shows the page link, or `cpub`'s `Error:` and `Fix:` lines; **Show full output** opens everything `cpub` printed. A run that takes longer than the timeout (default 120 seconds, in the settings) is stopped.

Undo is not in the plugin: `cpub undo` always asks for confirmation, so run it from a terminal.

## Privacy and safety

- **The plugin never reads, stores or sends your Confluence credentials** and makes **no network requests** itself. Only `cpub` talks to Confluence, with the credentials `cpub setup` saved on your computer.
- It runs `cpub` directly (no shell), so note names are never interpreted as commands.
- It never passes `--adopt` or any other flag that would let it take over a page `cpub` did not publish.

## Settings

- **cpub path**: empty means auto-detect.
- **Show ribbon button**.
- **Timeout (seconds)**.
- **Run check**: the same as the *Check cpub setup* command.

## Development

The plugin is written in TypeScript (`src/`) and bundled into `main.js` with esbuild; `main.js` is a build artifact, attached to each release and not kept in git. The only dependencies are development tools, pinned to exact versions; the plugin itself has no runtime dependencies.

```bash
npm ci              # install the pinned dev tools
npm run build       # src/main.ts -> main.js
npm run typecheck   # tsc --noEmit (strict)
npm test            # node --test on the .ts sources (Node 23.6+ strips the types)
```

To try a build, copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/confluence-publisher/` and reload Obsidian.

## License

MIT
