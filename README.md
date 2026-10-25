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
- **Multi-select and file menu** — <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>-click, <kbd>Shift</kbd>-click or <kbd>Shift</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> select several notes; right-click opens Obsidian's file menu for them
- **Navigation stack** — back/forward walk the queries you paused on, like a browser. Typing doesn't add an entry per keystroke
- **Configurable sort** — alphabetical (A→Z, Z→A), date created, or date modified
- **Folder exclusion** — exclude specific folders from the index, with autocomplete folder picker. Optionally respects Obsidian's native excluded files setting

## Usage

| Action | How |
| --- | --- |
| Open/focus Omnibar | Assign a hotkey to **Focus Omnibar** (or click the ribbon icon). If text is selected, it auto-searches |
| Search | Just type |
| Browse results | <kbd>↑</kbd> / <kbd>↓</kbd> |
| Open the selected note | <kbd>Enter</kbd> (focuses the editor and clears the search highlights) |
| Select several notes | <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>-click, <kbd>Shift</kbd>-click, <kbd>Shift</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd>. <kbd>Esc</kbd> clears the selection |
| File actions | Right-click a result (or the selection) |
| Navigate back/forward | ◀ / ▶ buttons in the Omnibar header. Each step restores a paused query, not every keystroke |

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
| Show content previews on mobile | On | Display short match snippets under results in the mobile search modal (phones and tablets only) |

## Mobile

On phones and tablets, the Omnibar opens as a full-screen search modal instead of a sidebar pane. The search field is docked at the bottom, in reach of your thumb, and rides on top of the keyboard. A bar at the top shows the match count and **Select**.

- **Bottom-up results** — the first row sits right above the search field and results read upward. Your current note is pinned at the bottom of the results
- **Operator buttons** — while the keyboard is open, a row above the field inserts `" "`, `( )`, `OR`, `NOT` (as `!`) and `#`. Quotes and parentheses wrap selected text; NOT and `#` prefix it
- **Open a note** — tap a result, or press **Go** on the keyboard to open the marked row. Both open the note with highlights and the cursor at the first match, and close search. Typing a note's exact title marks that note
- **Create a note** — a **Create new note** row ends the list for any non-blank query. Tap it to create the note, or open it if it already exists
- **Select** — long-press a row, or tap **Select** at the top, to show checkboxes. **Select all** and **Actions** (Obsidian's own file menu for the selected notes) replace the search field until you tap **Cancel**
- **Quick Look** — the eye on a row shows the whole note with matches highlighted, scrolled to the first match. Step with the arrows or a horizontal swipe. **Insert link** adds a link at the cursor of the note you came from; **Open** lands on the note shown
- **Back/forward** — the ◀ / ▶ buttons in the search field walk the queries you paused on, not every keystroke. History outlives closing the modal, and ◀ from an empty field returns to the query you left
- **Recent searches** — with an empty field, a row of chips for your latest queries sits just above your current note. Tap one to run it
- **Escape or back** — backs out one level: Quick Look, then selection, then search
- **Wiki-links and hashtags** route to the modal automatically
- **Content previews** (enabled by default): short match snippets appear under each result so you can preview context without leaving the modal. Controlled by the "Show content previews on mobile" setting. Variable-height rows stay comfortable and touch-friendly (0, 1, or 2 snippet lines).

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

[BRAT](https://github.com/TfTHacker/obsidian42-brat) installs the plugin from this repository's GitHub releases and keeps it up to date. The steps are the same on desktop and mobile.

1. Go to **Settings → Community plugins → Browse**, search for **BRAT**, then install and enable it.
2. Open the command palette and run **BRAT: Plugins: Add a beta plugin for testing**.
3. Paste this repository and select **Add plugin**:
   ```
   wScottSh/the-archive-search-obsidian-plugin
   ```
4. In **Settings → BRAT**, turn on **Auto-update plugins at startup**.

To update right away, run **BRAT: Plugins: Check for updates to all beta plugins and UPDATE** from the command palette. BRAT installs the latest release and reloads the plugin.

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

### Releasing

Every merge or push to `master` publishes a patch release. The Release workflow bumps the version, tags it, and attaches `main.js`, `manifest.json`, and `styles.css`. For a minor or major release, go to **Actions → Release → Run workflow** and pick the bump.

## Background

[The Archive](https://zettelkasten.de/the-archive/) is a macOS note-taking app by Christian Tietze, designed around the Zettelkasten method. Its defining feature is an Omnibar that treats search and navigation as one action. This plugin replicates that search behavior inside Obsidian.

This is not affiliated with Zettelkasten.de or The Archive.

## License

[MIT](LICENSE)
