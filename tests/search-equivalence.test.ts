/**
 * Pins SearchEngine.search to the straightforward implementation it started
 * as: evaluate every note, build every snippet, sort with localeCompare. Any
 * speedup must return the same notes, in the same order, with the same
 * filename flags and snippet pieces.
 */

import { describe, it, expect } from 'vitest';
import { SearchEngine, SnippetPiece, foldCase, highlightPieces } from '../src/search-engine';
import { parseQuery, SearchNode } from '../src/parser';
import { extractSearchTerms } from '../src/editor-highlight';
import type { SortOrder } from '../src/settings';
import { TFile } from 'obsidian';

interface Note {
    path: string;
    content: string;
    ctime: number;
    mtime: number;
}

const FILLER = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore ';

const NOTES: Note[] = [
    ['Apple pie.md', 'Baking an apple pie with Blah and blah.', 3, 9],
    ['apple pie.md', 'lower-case twin of Apple pie', 3, 9],
    ['a/Note.md', 'Note in folder a. ' + FILLER.repeat(3) + 'blah at the end', 1, 1],
    ['b/Note.md', 'Note in folder b. bl', 1, 1],
    ['note.md', FILLER.repeat(5) + 'the BLAH is deep inside ' + FILLER.repeat(5), 2, 2],
    ['Éclair.md', 'pâtisserie with crème; Eclair without accent', 5, 4],
    ['eclair.md', 'plain eclair, also ÉCLAIR', 5, 4],
    ['Zebra 10.md', 'zebra ten, number sort', 7, 3],
    ['Zebra 2.md', 'zebra two', 7, 3],
    ['zebra 2.md', 'zebra two again', 8, 3],
    ['İstanbul.md', 'İstanbul and istanbul and İİ', 6, 6],
    ['日本語.md', '日本語のノート blah', 4, 8],
    ['🙂 smile.md', 'emoji title, phrase here and there', 9, 7],
    ['_underscore.md', '#tag phrase here', 10, 5],
    ['  spaced.md', 'Spaced title, bla bla', 10, 5],
    ['Blah.md', 'title only', 11, 11],
    ['blah blah.md', '', 12, 12],
    ['Bl.md', 'b', 13, 0],
    ['empty.md', '', 0, 13],
    ['Ångström.md', 'units: Å and å, angstrom', 2, 10],
].map(([path, content, ctime, mtime]) => ({ path, content, ctime, mtime } as Note));

const QUERIES = [
    '', ' ', 'b', 'B', 'e', 'é', 'bl', 'bla', 'blah', 'BLAH', 'note', 'zebra 2', '"phrase here"', '"blah blah"',
    'apple OR zebra', 'a !b', '!blah', 'NOT note', '(apple OR zebra) two', 'İ', 'i', 'istanbul', '#tag', 'å',
    'missing', 'blah "deep inside"', 'Blah', 'Apple pie', '"Apple pie"', 'x OR', '日本', '🙂',
];

const SORT_ORDERS: SortOrder[] = ['a-z', 'z-a', 'created-new', 'created-old', 'modified-new', 'modified-old'];

function basenameOf(path: string): string {
    return path.substring(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
}

function fileFor(note: Note): TFile {
    return Object.assign(new TFile(), {
        path: note.path,
        basename: basenameOf(note.path),
        extension: 'md',
        stat: { ctime: note.ctime, mtime: note.mtime, size: note.content.length },
    });
}

/** A vault over `notes`; edit the array to change what it reads. */
function makeApp(notes: Note[]) {
    return {
        vault: {
            getMarkdownFiles: () => notes.map(fileFor),
            cachedRead: async (file: TFile) => (notes.find((note) => note.path === file.path) as Note).content,
        },
    };
}

async function makeEngine(sortOrder: SortOrder, notes: Note[] = NOTES): Promise<SearchEngine> {
    const settings = { sortOrder, excludedFolders: [], respectObsidianExcluded: false };
    const engine = new SearchEngine(makeApp(notes) as never, settings as never);
    await engine.buildIndex();
    return engine;
}

// ─── Reference: the original implementation ──────────────────────

interface ReferenceEntry {
    path: string;
    filename: string;
    content: string;
    rawContent: string;
    rawFilename: string;
    ctime: number;
    mtime: number;
}

function referenceEvaluate(node: SearchNode, entry: ReferenceEntry): boolean {
    switch (node.type) {
        case 'WORD':
        case 'PHRASE': {
            const term = foldCase(node.value);
            return entry.filename.includes(term) || entry.content.includes(term);
        }
        case 'AND':
            return referenceEvaluate(node.left, entry) && referenceEvaluate(node.right, entry);
        case 'OR':
            return referenceEvaluate(node.left, entry) || referenceEvaluate(node.right, entry);
        case 'NOT':
            return !referenceEvaluate(node.operand, entry);
    }
}

function referenceSnippet(entry: ReferenceEntry, terms: string[]): SnippetPiece[] | undefined {
    const content = entry.content;
    let firstPos = -1;
    let matchLen = 0;
    for (const term of terms) {
        const t = foldCase(term);
        if (!t) continue;
        const pos = content.indexOf(t);
        if (pos !== -1 && (firstPos === -1 || pos < firstPos)) {
            firstPos = pos;
            matchLen = t.length;
        }
    }
    if (firstPos === -1) return undefined;
    const start = Math.max(0, firstPos - 50);
    const end = Math.min(content.length, firstPos + matchLen + 50);
    const inner = entry.rawContent.substring(start, end).trim();
    if (!inner) return undefined;
    const pieces = highlightPieces(inner, terms);
    if (start > 0) pieces.unshift({ text: '... ', hit: false });
    if (end < content.length) pieces.push({ text: '...', hit: false });
    return pieces;
}

interface Projected {
    path: string;
    filename: string;
    matchInFilename: boolean;
    snippet: SnippetPiece[] | undefined;
}

function referenceSearch(query: string, sortOrder: SortOrder, notes: Note[] = NOTES): Projected[] {
    const entries: ReferenceEntry[] = notes.map((note) => {
        const basename = basenameOf(note.path);
        return {
            path: note.path,
            filename: foldCase(basename),
            content: foldCase(note.content),
            rawContent: note.content,
            rawFilename: basename,
            ctime: note.ctime,
            mtime: note.mtime,
        };
    });
    const ast = parseQuery(query);
    const terms = ast ? extractSearchTerms(ast) : [];
    const queryLower = foldCase(query);
    const results = entries
        .filter((entry) => !ast || referenceEvaluate(ast, entry))
        .map((entry) => ({
            entry,
            projected: {
                path: entry.path,
                filename: entry.rawFilename,
                matchInFilename: ast ? entry.filename.includes(queryLower) : false,
                snippet: ast ? referenceSnippet(entry, terms) : undefined,
            },
        }));
    const compare: Record<SortOrder, (a: ReferenceEntry, b: ReferenceEntry) => number> = {
        'a-z': (a, b) => a.rawFilename.localeCompare(b.rawFilename),
        'z-a': (a, b) => b.rawFilename.localeCompare(a.rawFilename),
        'created-new': (a, b) => b.ctime - a.ctime,
        'created-old': (a, b) => a.ctime - b.ctime,
        'modified-new': (a, b) => b.mtime - a.mtime,
        'modified-old': (a, b) => a.mtime - b.mtime,
    };
    results.sort((a, b) => compare[sortOrder](a.entry, b.entry));
    return results.map((r) => r.projected);
}

function project(engine: SearchEngine, query: string): Projected[] {
    return engine.search(query).map((result) => ({
        path: result.file.path,
        filename: result.filename,
        matchInFilename: result.matchInFilename,
        snippet: result.snippet,
    }));
}

describe('SearchEngine.search matches the original implementation', () => {
    for (const sortOrder of SORT_ORDERS) {
        it(`returns the same results in the same order, sorted ${sortOrder}`, async () => {
            const engine = await makeEngine(sortOrder);
            for (const query of QUERIES) {
                expect({ query, results: project(engine, query) }).toEqual({ query, results: referenceSearch(query, sortOrder) });
            }
        });
    }

    it('follows a sort order changed in place on the shared settings object', async () => {
        const engine = await makeEngine('a-z');
        project(engine, 'b');
        (engine as unknown as { settings: { sortOrder: SortOrder } }).settings.sortOrder = 'z-a';
        expect(project(engine, 'b')).toEqual(referenceSearch('b', 'z-a'));
    });

    it('keeps name order through notes created, deleted and renamed', async () => {
        const notes = [...NOTES];
        const engine = await makeEngine('z-a', notes);
        const events = engine.getEventRefs();
        const check = () => {
            for (const query of ['', 'b', 'note', 'zebra']) expect(project(engine, query)).toEqual(referenceSearch(query, 'z-a', notes));
        };
        check();

        const created = { path: 'Blah 2.md', content: 'new blah', ctime: 20, mtime: 20 };
        notes.push(created);
        await events.onCreate(fileFor(created));
        check();

        const deleted = notes.findIndex((note) => note.path === 'zebra 2.md');
        events.onDelete(fileFor(notes[deleted]));
        notes.splice(deleted, 1);
        check();

        const renamedAt = notes.findIndex((note) => note.path === 'Apple pie.md');
        const renamed = { ...notes[renamedAt], path: 'zz/Banana pie.md' };
        notes.splice(renamedAt, 1);
        notes.push(renamed);
        await events.onRename(fileFor(renamed), 'Apple pie.md');
        check();
    });

    it('gives a result the same snippet on every read', async () => {
        const engine = await makeEngine('a-z');
        const [first] = engine.search('blah');
        const before = first.snippet;
        expect(first.snippet).toBe(before);
        expect(first.snippet).toEqual(referenceSearch('blah', 'a-z')[0].snippet);
    });
});
