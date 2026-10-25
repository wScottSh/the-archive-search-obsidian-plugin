// PROTOTYPE — fake flat-Zettelkasten vault. In memory only.

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 24, 12);

// [path, content, createdDaysAgo, modifiedDaysAgo]
const RAW: [string, string, number, number][] = [
    ['202409011200 Zettelkasten is a thinking tool, not an archive.md', `# Zettelkasten is a thinking tool, not an archive

The value of a [[Zettelkasten]] is not storage. It is the *friction* of writing a note in your own words and linking it to what already exists.

Storage without connection is a graveyard. See [[202409021015 Atomic notes make links meaningful]] and [[202410051130 Links over folders]].

#zettelkasten #thinking`, 420, 12],
    ['202409021015 Atomic notes make links meaningful.md', `# Atomic notes make links meaningful

A note should hold **one idea**. When a note holds three ideas, a link to it is ambiguous: which of the three did you mean?

Atomicity is what lets a link carry meaning. It is the precondition for [[Folgezettel]] and for structure notes.

Related: [[202409011200 Zettelkasten is a thinking tool, not an archive]]

#zettelkasten #atomicity`, 419, 40],
    ['202410051130 Links over folders.md', `# Links over folders

Folders force a note to live in one place. Links let it live in many contexts at once.

The Archive keeps everything in one flat folder and relies on search plus links. A good search *is* the navigation.

- Folders answer "where did I put it?"
- Links answer "what is it connected to?"

#zettelkasten #navigation`, 385, 5],
    ['202410120900 Search is navigation.md', `# Search is navigation

In The Archive the Omnibar is both search box and address bar. Typing a title opens it; typing a word lists every note that mentions it.

This collapses two actions (find, then open) into one. On a phone, that collapse matters even more: every extra tap is a reason not to look something up.

See [[202410051130 Links over folders]] and [[202501101400 Mobile capture should be one gesture]].

#navigation #search #mobile`, 378, 2],
    ['202410200830 Spaced repetition beats cramming.md', `# Spaced repetition beats cramming

Reviewing material at expanding intervals produces far better long-term retention than massed practice.

The effect is robust across ages and subjects. The cost is that it *feels* less productive than cramming, which is why people avoid it.

Connects to [[202410211000 Desirable difficulties]].

#learning #memory`, 370, 90],
    ['202410211000 Desirable difficulties.md', `# Desirable difficulties

Bjork's term for learning conditions that slow initial performance but improve retention: spacing, interleaving, retrieval practice, variation.

Writing a Zettel in your own words is a desirable difficulty. Copy-pasting a highlight is not.

See [[202410200830 Spaced repetition beats cramming]], [[202409011200 Zettelkasten is a thinking tool, not an archive]].

#learning #memory #writing`, 369, 60],
    ['202411031545 Retrieval practice.md', `# Retrieval practice

Trying to recall something strengthens memory more than re-reading it. The struggle to retrieve is the point.

Searching your own archive before writing a new note is a small act of retrieval practice.

#learning #memory`, 356, 120],
    ['202411150700 Writing is thinking.md', `# Writing is thinking

You do not have thoughts and then write them down. Writing is where the thought gets its shape.

"I don't know what I think until I write it down." This is why a [[Zettelkasten]] built from your own sentences outperforms a highlight collection.

#writing #thinking`, 344, 30],
    ['202412010930 Structure notes.md', `# Structure notes

A structure note (or "hub", or "MOC") is a note whose content is mostly links, arranged with commentary.

It is a table of contents you write *after* the notes exist, not a folder you create before.

- [[202409011200 Zettelkasten is a thinking tool, not an archive]]
- [[202409021015 Atomic notes make links meaningful]]
- [[202410051130 Links over folders]]
- [[202410120900 Search is navigation]]

#zettelkasten #structure`, 328, 8],
    ['202412051210 Folgezettel.md', `# Folgezettel

Luhmann's numbering scheme (1, 1a, 1a1, 1b...) placed a new note physically next to the note it continued.

In a digital archive the number is less important than the explicit link, but the *habit* of asking "what does this continue?" is worth keeping.

#zettelkasten #luhmann`, 324, 200],
    ['Zettelkasten.md', `# Zettelkasten

German for "slip box". A collection of short, linked notes used as a thinking partner.

Entry points: [[202412010930 Structure notes]], [[202409011200 Zettelkasten is a thinking tool, not an archive]].

#zettelkasten #index`, 430, 3],
    ['202501101400 Mobile capture should be one gesture.md', `# Mobile capture should be one gesture

On a phone, the distance between "I had a thought" and "it is saved" must be one gesture. Two gestures and the thought is gone.

The same applies to lookup: if searching the archive takes more than a tap and a few letters, you will not do it on the train.

Keyboard behavior is the hidden cost. Half the screen disappears the moment you type, and any UI that ignores that feels broken.

#mobile #capture #ux`, 287, 1],
    ['202501121030 Thumb zone.md', `# Thumb zone

On a large phone, the top third of the screen is a stretch for one-handed use. Primary actions belong in the bottom half, where the thumb rests.

The keyboard occupies exactly that bottom half while typing, which pushes the thumb zone up to the strip just above it.

#mobile #ux #ergonomics`, 285, 4],
    ['202501150915 The keyboard is half the screen.md', `# The keyboard is half the screen

A software keyboard takes 40–50% of a phone's height. A search UI must decide what lives in the remaining half *while typing*, and what returns when the keyboard goes away.

Good patterns:
- input stays attached to the top of the keyboard, or pinned to the top of the screen, never in between
- results list shrinks, it does not get covered
- dismissing the keyboard should reveal more results, not shift the input

#mobile #ux #keyboard`, 282, 1],
    ['202502011100 Boolean search on a phone.md', `# Boolean search on a phone

Typing \`"exact phrase"\`, \`(a OR b)\`, or \`!term\` on a phone keyboard means switching to the symbol layer for every operator.

A row of operator keys above the keyboard removes that friction without hiding the power.

#search #mobile #boolean`, 265, 2],
    ['202502101330 Progressive disclosure.md', `# Progressive disclosure

Show the common thing first; reveal the advanced thing on demand. A search box with an optional syntax helper is progressive disclosure.

#ux #design`, 256, 70],
    ['202503031800 Deep work.md', `# Deep work

Cal Newport: professional activity performed in distraction-free concentration that pushes cognitive capabilities to their limit.

A notes system should reduce the cost of returning to deep work, not become a distraction itself.

#productivity #focus`, 235, 150],
    ['202503101015 Attention residue.md', `# Attention residue

When you switch tasks, part of your attention stays on the previous one. Frequent switching leaves you permanently partially distracted.

Related: [[202503031800 Deep work]]

#productivity #focus #attention`, 228, 160],
    ['202504020745 Evergreen notes.md', `# Evergreen notes

Andy Matuschak's term for notes written to evolve and accumulate over time, across projects.

Evergreen notes should be atomic, concept-oriented, densely linked, and titled as claims. Compare [[202409021015 Atomic notes make links meaningful]].

#zettelkasten #writing`, 205, 25],
    ['202504101600 Titles as claims.md', `# Titles as claims

A note titled "Memory" says nothing. A note titled "Spaced repetition beats cramming" makes a claim you can link to, argue with, and build on.

Claim titles also make search results scannable: the result list reads like an argument.

#writing #zettelkasten`, 197, 9],
    ['202505050900 Inbox zero for notes.md', `# Inbox zero for notes

Fleeting notes pile up. Process them daily into permanent notes or delete them. An inbox with 400 items is not an inbox, it is a second archive nobody reads.

#productivity #workflow`, 172, 45],
    ['202505201230 Reading with a pen.md', `# Reading with a pen

Reading without writing is entertainment. Keep a pen (or a note) open and write one sentence per idea worth keeping, in your own words.

See [[202411150700 Writing is thinking]].

#reading #writing`, 157, 33],
    ['202506011000 Interleaving.md', `# Interleaving

Mixing different types of problems in one practice session improves the ability to choose the right method, compared to blocked practice.

One of the [[202410211000 Desirable difficulties]].

#learning`, 145, 100],
    ['202506151445 Forgetting curve.md', `# Forgetting curve

Ebbinghaus showed memory decays roughly exponentially without review. Each successful retrieval flattens the curve.

See [[202410200830 Spaced repetition beats cramming]].

#memory #learning`, 131, 110],
    ['202507041100 Local-first software.md', `# Local-first software

Your data lives on your device first and syncs second. Works offline, stays fast, survives the vendor going away.

Plain text Markdown files are the most local-first format there is.

#software #privacy`, 112, 18],
    ['202507201900 Plain text lasts.md', `# Plain text lasts

Proprietary formats die with their apps. Plain text opened in 1985 still opens today.

#software #longevity`, 96, 50],
    ['202508080815 Hashtags as lightweight structure.md', `# Hashtags as lightweight structure

A #tag is a link to a search. Clicking it should run that search, not open a tag page.

In The Archive, tags are just text: searching \`#mobile\` finds every note that contains it.

#search #tags #structure`, 77, 6],
    ['202508250930 Wiki-links as search queries.md', `# Wiki-links as search queries

In The Archive a \`[[link]]\` is a saved search. Following it runs the query; if exactly one note matches the title, that note opens.

This makes broken links impossible: a link to something that does not exist yet simply shows related notes and offers to create it.

See [[202410120900 Search is navigation]], [[202508080815 Hashtags as lightweight structure]].

#search #links`, 60, 2],
    ['202509101100 Context menus on touch.md', `# Context menus on touch

Desktop has right-click; touch has long-press. Long-press is undiscoverable, so it should only hold secondary actions, and selection mode should also be reachable from a visible control.

#mobile #ux`, 44, 3],
    ['202509221300 Haptics confirm intent.md', `# Haptics confirm intent

A short vibration on long-press or on entering selection mode tells the user the gesture registered before anything visual changes.

#mobile #ux`, 32, 3],
    ['202510011700 Bottom sheets.md', `# Bottom sheets

A bottom sheet keeps context visible behind it while offering detail in the thumb zone. Detents (peek, half, full) let the user choose how much context to trade for content.

Sheets interact badly with keyboards unless they snap to the keyboard's top edge.

#mobile #ux #design`, 23, 1],
    ['202510150800 Preview before commit.md', `# Preview before commit

Arrow-key browsing in the Omnibar shows each note in the editor as you move. You read before you choose. A mobile search without preview forces open-check-back-open loops.

#search #ux`, 9, 1],
    ['Sources/Ahrens - How to Take Smart Notes.md', `# Ahrens — How to Take Smart Notes

Literature notes on Sönke Ahrens (2017).

- Writing is the medium of thinking, not its output
- Permanent notes in your own words
- The slip-box as a communication partner

Linked: [[202411150700 Writing is thinking]], [[Zettelkasten]]

#source #book #zettelkasten`, 400, 300],
    ['Sources/Brown et al - Make It Stick.md', `# Brown, Roediger, McDaniel — Make It Stick

Literature notes. Retrieval practice, spacing, interleaving, elaboration, generation, reflection, calibration.

Linked: [[202411031545 Retrieval practice]], [[202410211000 Desirable difficulties]]

#source #book #learning`, 380, 250],
    ['Sources/Newport - Deep Work.md', `# Newport — Deep Work

Literature notes. Deep vs. shallow work; attention residue; scheduling every minute.

Linked: [[202503031800 Deep work]], [[202503101015 Attention residue]]

#source #book #productivity`, 240, 230],
    ['Projects/Archive Search plugin/Mobile redesign.md', `# Mobile redesign

Goals for the mobile search UI:

1. Feel native and calm, not like a desktop panel squeezed into a phone
2. Full desktop parity: boolean search, preview-before-open, current note, exact title match, create note, multi-select with file actions, back/forward history
3. Handle the keyboard: half the screen vanishes and comes back

Notes: [[202501150915 The keyboard is half the screen]], [[202510011700 Bottom sheets]], [[202501121030 Thumb zone]], [[202510150800 Preview before commit]]

#project #mobile`, 6, 0],
    ['Projects/Archive Search plugin/Release checklist.md', `# Release checklist

- bump version, update versions.json
- build, test, attach main.js + manifest.json + styles.css to the release
- smoke-test on iPhone and Android

#project`, 40, 20],
];

export interface VaultNote {
    path: string;
    content: string;
    ctime: number;
    mtime: number;
}

export const NOTES: VaultNote[] = RAW.map(([path, content, c, m]) => ({
    path,
    content,
    ctime: NOW - c * DAY,
    mtime: NOW - m * DAY,
}));
