# PROTOTYPE verdict — mobile search UI

**Question:** what should the mobile search UI look like so it is beautiful, matches the
desktop's features, and handles the keyboard taking half the screen?

**Answer:** Variant A, "Thumb Dock" (`variants/variant-a.ts`, `styles/variant-a.css`).
Chosen by Scott on 2026-10-24. B (Split Browser) and C (Sheet over Note) lost and stay here for reference only.

Run it: `npm run prototype:mobile`, then open `?variant=A` (desktop: drawn phone + keyboard; phone: real keyboard).

## What A is

- Full-screen sheet. The search capsule (back/forward, input, clear, close) is docked at the
  bottom of the visible area, so it rides on the keyboard and settles above the home indicator
  when the keyboard drops. The input never moves relative to its edge.
- An operator chip row (`" "`, `( )`, `OR`, `NOT`, `#`) above the capsule, shown only while the keyboard is up.
- Results stack bottom-up: pinned Current note sits nearest the thumb, results read upward, the
  Create note row is at the far end. Rows show the title with hits highlighted, the folder, and a
  case-preserving 2-line snippet.
- Tap = open with highlights + caret at first match. Long-press or the visible Select button =
  multi-select; an action bar (file actions) replaces the capsule.
- Eye button per row = Quick Look: full note with highlights, prev/next or swipe (desktop
  arrow-key browse), Insert link, Open.
- Empty query: recent-query chips + all notes. Scrolling the list dismisses the keyboard.

## Carry into the real build (not variant-specific)

- Size the modal to `visualViewport`; predict the keyboard-open state on focus from the last
  measured height so layout moves with the keyboard (iOS reports only after the animation). See `viewport.ts`.
- Focus the input synchronously inside the opening tap; the current modal's 50ms `setTimeout` focus
  likely won't raise the iOS keyboard (unverified in Obsidian).
- Snippets must be cut from original-case text; `SearchEngine.extractSnippet` cuts from the
  lowercased index, so mobile previews render lowercase today.
- Coalesce nav-stack pushes (desktop pushes per keystroke). See `SearchSession.pushNav` in `session.ts`.

## Open gaps

- Only tested in the drawn phone, not on a real device or inside Obsidian.
- No `[[` chip: the parser treats `[[` as a plain word, so it would match every note with a link.
- No sort indicator/control. Quick Look's "n of N" counts the current-note row.
- Obsidian's global input/button styles will need overrides; the prototype uses `!important` on buttons.
- Rename / Move / Delete are stubs; production should route them through Obsidian's `file-menu` / `files-menu`.
