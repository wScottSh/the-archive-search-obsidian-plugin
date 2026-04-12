# The Archive Search for Obsidian

Brings [The Archive's](https://zettelkasten.de/the-archive/) search-as-you-type Omnibar to Obsidian. One search field to find, browse, and create notes — keyboard-first, always visible.

If you use a flat Zettelkasten and miss The Archive's workflow on non-macOS platforms (or just want it inside Obsidian), this is that.

## How it works

A persistent sidebar pane with a single search field. Type to filter. Arrow keys to browse. The selected note opens instantly in the editor. Press Enter on a query with no results to create a new note with that title.

Wiki-links become search queries: clicking `[[some topic]]` doesn't open a file — it searches for "some topic" and shows you everything related.

## Features

- **Boolean search** — `AND`, `OR`, `NOT`, `!`, `"exact phrases"`, and `(parentheses)` for grouping. Implicit AND between words (typing `foo bar` finds notes containing both)
- **Real-time filtering** — results update as you type, no Enter required
- **Arrow-key browsing** — up/down moves through results but keeps your cursor in the search field. The selected note opens in the editor pane beside the Omnibar
- **Search highlighting** — matching terms are highlighted in the editor with auto-scroll to the first match
- **Wiki-link interception** — `[[links]]` trigger a search instead of Obsidian's default open-or-create
- **Note creation** — Enter on a no-results query creates a new note with a configurable timestamp prefix (e.g. `202604111944 My New Note.md`)
- **Navigation stack** — unlimited back/forward history, like a browser
- **Configurable sort** — alphabetical (A→Z, Z→A), date created, or date modified
- **Folder exclusion** — exclude specific folders from the index, with autocomplete folder picker. Optionally respects Obsidian's native excluded files setting

## Usage

| Action | How |
| --- | --- |
| Open/focus Omnibar | Assign a hotkey to **Focus Omnibar** (or click the ribbon icon) |
| Search | Just type |
| Browse results | <kbd>↑</kbd> / <kbd>↓</kbd> |
| Create note from query | <kbd>Enter</kbd> when no results match |
| Search selected text | Assign a hotkey to **Search selection in Omnibar** |
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
| Note ID format | `YYYYMMDDHHmm` | Any [Moment.js format string](https://momentjs.com/docs/#/displaying/format/). Has a live preview in settings. Leave empty for no prefix |
| ID separator | (space) | Character between the timestamp and the note title |
| New note folder | Vault root | Where created notes go (with autocomplete picker) |

## Installation

### Community plugins (not yet submitted)

This plugin isn't on the community plugin list yet. For now, install manually.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/wScottSh/the-archive-search-obsidian-plugin/releases)
2. Create a folder: `<your vault>/.obsidian/plugins/the-archive-search/`
3. Copy the three files into that folder
4. Open Obsidian → Settings → Community plugins → enable "The Archive Search"

### BRAT

Install via [BRAT](https://github.com/TfTHacker/obsidian42-brat) using this repo URL:
```
wScottSh/the-archive-search-obsidian-plugin
```

## Background

[The Archive](https://zettelkasten.de/the-archive/) is a macOS note-taking app by Christian Tietze, designed around the Zettelkasten method. Its defining feature is an Omnibar that treats search, navigation, and creation as one action. This plugin replicates that behavior inside Obsidian.

This is not affiliated with Zettelkasten.de or The Archive.

## License

[MIT](LICENSE)
