# The Archive Search for Obsidian

Brings [The Archive's](https://zettelkasten.de/the-archive/) search-as-you-type Omnibar to Obsidian. One search field to find and browse notes — keyboard-first, always visible.

If you use a flat Zettelkasten and miss The Archive's workflow on non-macOS platforms (or just want it inside Obsidian), this is that.

## How it works

A persistent sidebar pane with a single search field. Type to filter. Arrow keys to browse. The selected note opens instantly in the editor. If you have text selected, the hotkey auto-populates the search.

Wiki-links become search queries: clicking `[[some topic]]` doesn't open a file — it searches for "some topic" and shows you everything related.

## Features

- **Boolean search** — `AND`, `OR`, `NOT`, `!`, `"exact phrases"`, and `(parentheses)` for grouping. Implicit AND between words (typing `foo bar` finds notes containing both)
- **Real-time filtering** — results update as you type, no Enter required
- **Arrow-key browsing** — up/down moves through results but keeps your cursor in the search field. The selected note opens in the editor pane beside the Omnibar
- **Search highlighting** — matching terms are highlighted in the editor with auto-scroll to the first match
- **Wiki-link interception** — `[[links]]` trigger a search instead of Obsidian's default open-or-create (works in both Live Preview and Reading mode)
- **Selection search** — select text in the editor, press the hotkey, and it searches immediately
- **Folder path display** — each result shows its folder path on the right
- **Navigation stack** — unlimited back/forward history, like a browser
- **Configurable sort** — alphabetical (A→Z, Z→A), date created, or date modified
- **Folder exclusion** — exclude specific folders from the index, with autocomplete folder picker. Optionally respects Obsidian's native excluded files setting

## Usage

| Action | How |
| --- | --- |
| Open/focus Omnibar | Assign a hotkey to **Focus Omnibar** (or click the ribbon icon). If text is selected, it auto-searches |
| Search | Just type |
| Browse results | <kbd>↑</kbd> / <kbd>↓</kbd> |
| Navigate back/forward | ◀ / ▶ buttons in the Omnibar header |

## Search syntax

| Syntax | Meaning |
| --- | --- |
| `foo bar` | Notes containing both "foo" and "bar" |
| `foo AND bar` | Same as above (explicit) |
| `foo OR bar` | Notes containing either |
| `NOT foo` or `!foo` | Exclude notes containing "foo" |
| `"exact phrase"` | Match the literal string |
| `(foo OR bar) baz` | Grouping with parentheses |
| `\AND` | Backslash escapes operators: searches for literal "AND" |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Sort order | A → Z | Alphabetical, reverse, by creation date, or by modification date |
| Highlight search matches | On | Highlight matching terms in the editor |
| Omnibar position | Right | Left or right sidebar |
| Show ribbon icon | On | Toggle the sidebar search icon |
| Intercept wiki-links | On | `[[links]]` trigger searches instead of opening files |
| Excluded folders | — | Folders to skip (with autocomplete picker) |
| Respect Obsidian excluded files | On | Also honor Settings → Files & Links → Excluded files |

## Mobile

On phones and tablets, the Omnibar opens as a full-screen search modal instead of a sidebar pane.

- **Tap a result** to open the note
- **Wiki-links and hashtags** route to the modal automatically
- **Real-time filtering** works the same as desktop — results update on every keystroke
- **Back/forward navigation** is preserved via header buttons

### Adding to your mobile toolbar

1. Open **Settings → Mobile → Manage toolbar options**
2. Tap **Add global command**
3. Search for **"Focus Omnibar"** and add it
4. The search icon will now appear in your editing toolbar

You can also set it as your **pull-down Quick Action** under **Settings → Toolbar**.

## Privacy & Data

The Archive Search is **100% local**.

- It never sends any data anywhere.
- It does not phone home, collect analytics, or require an internet connection.
- All indexing and searching happens entirely inside your vault on your device.
- No external services, accounts, or API keys are used or required.

This plugin exists to give you fast, private, keyboard-centric search — nothing more.

## Installation

### From GitHub Releases (recommended for stability)

1. Download the latest release assets (`main.js`, `manifest.json`, and `styles.css`) from the [Releases page](https://github.com/wScottSh/the-archive-search-obsidian-plugin/releases).
2. In your vault, create the folder `.obsidian/plugins/the-archive-search/`.
3. Copy the three files into that folder.
4. Go to **Settings → Community plugins**, disable Safe mode if needed, and enable **The Archive Search**.

### Using BRAT (for testing latest changes)

Install via [BRAT](https://github.com/TfTHacker/obsidian42-brat) using this repository URL:
```
wScottSh/the-archive-search-obsidian-plugin
```

> **Note:** This plugin is not yet listed in the official Obsidian Community Plugins directory. Once it is submitted and approved, it will be installable directly from Obsidian's plugin browser.

### Building from source

If you want to build the plugin yourself:

```bash
git clone https://github.com/wScottSh/the-archive-search-obsidian-plugin.git
cd the-archive-search-obsidian-plugin
npm install
npm run build
```

Then copy the generated `main.js`, `manifest.json`, and `styles.css` into your vault's plugin folder as described above.

## Background

[The Archive](https://zettelkasten.de/the-archive/) is a macOS note-taking app by Christian Tietze, designed around the Zettelkasten method. Its defining feature is an Omnibar that treats search and navigation as one action. This plugin replicates that search behavior inside Obsidian.

This is not affiliated with Zettelkasten.de or The Archive.

## License

[MIT](LICENSE)
