/**
 * Search session tests: the real search engine over the obsidian mock and an
 * in-memory vault, with a recording workspace adapter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TFile } from 'obsidian';
import { SearchEngine } from '../src/search-engine';
import { SearchSession, Workspace, highlightPieces, HISTORY_MERGE_MS } from '../src/search-session';

// ─── Helpers ─────────────────────────────────────────────────────

function makeFile(basename: string): TFile {
    const file = new (TFile as any)(`${basename}.md`, basename, 'md') as TFile;
    (file as any).parent = null;
    (file as any).stat = { ctime: 0, mtime: 0 };
    return file;
}

/** Workspace adapter that records its calls. */
function recorder() {
    const calls: Array<{ method: string; file?: TFile; terms?: string[]; title?: string }> = [];
    const workspace: Workspace = {
        preview: (file, terms) => calls.push({ method: 'preview', file, terms }),
        land: (file, terms) => calls.push({ method: 'land', file, terms }),
        create: (title) => calls.push({ method: 'create', title }),
        openFileMenu: () => calls.push({ method: 'openFileMenu' }),
    };
    return { calls, workspace };
}

async function setup(notes: Record<string, string>) {
    const files = Object.keys(notes).map((name) => makeFile(name));
    const app = {
        vault: {
            getMarkdownFiles: () => files,
            cachedRead: async (file: TFile) => notes[file.basename],
        },
    };
    const engine = new SearchEngine(app as any, {
        sortOrder: 'a-z',
        excludedFolders: [],
        respectObsidianExcluded: false,
    } as any);
    await engine.buildIndex();
    const { calls, workspace } = recorder();
    const session = new SearchSession(engine, workspace);
    return { session, calls, files: Object.fromEntries(files.map((f) => [f.basename, f])) };
}

const NOTES = {
    Apple: 'An Apple a day keeps the doctor away',
    Banana: 'Bananas are yellow',
    Cherry: 'Cherry pie with apple filling',
};

const shape = (session: SearchSession) =>
    session.rows().map((row) => (row.kind === 'result' ? row.result.filename : row.kind));

// ─── Tests ───────────────────────────────────────────────────────

describe('SearchSession rows', () => {
    it('lists all notes for an empty query, with no create row', async () => {
        const { session } = await setup(NOTES);
        session.open(null);
        expect(shape(session)).toEqual(['Apple', 'Banana', 'Cherry']);
    });

    it('pins the current note first when present', async () => {
        const { session, files } = await setup(NOTES);
        session.open(files.Banana);
        expect(shape(session)).toEqual(['current', 'Apple', 'Banana', 'Cherry']);
        expect(session.rows()[0]).toMatchObject({ kind: 'current', file: files.Banana });
    });

    it('puts the create row last for a non-blank query', async () => {
        const { session, files } = await setup(NOTES);
        session.open(files.Banana, 'apple');
        expect(shape(session)).toEqual(['current', 'Apple', 'Cherry', 'create']);
        expect(session.rows().at(-1)).toEqual({ kind: 'create', title: 'apple' });
    });

    it('has no create row for a blank query', async () => {
        const { session } = await setup(NOTES);
        session.open(null, '   ');
        expect(shape(session)).not.toContain('create');
    });

    it('has only the pinned and create rows when nothing matches', async () => {
        const { session, files } = await setup(NOTES);
        session.open(files.Apple, 'zzz');
        expect(shape(session)).toEqual(['current', 'create']);
    });

    it('returns snippets in original case', async () => {
        const { session } = await setup(NOTES);
        session.open(null, 'apple');
        const row = session.rows()[0];
        if (row.kind !== 'result') throw new Error('expected a result row');
        const text = row.result.snippet!.map((p) => p.text).join('');
        expect(text).toContain('An Apple a day');
        expect(row.result.snippet!.some((p) => p.hit && p.text === 'Apple')).toBe(true);
    });
});

describe('SearchSession activate and land', () => {
    it('activate previews the row without landing', async () => {
        const { session, calls, files } = await setup(NOTES);
        session.open(null, 'appl');
        session.activate(1);
        expect(session.active).toBe(1);
        expect(calls).toEqual([{ method: 'preview', file: files.Cherry, terms: ['appl'] }]);
    });

    it('activate on the create row previews nothing', async () => {
        const { session, calls } = await setup(NOTES);
        session.open(null, 'zzz');
        session.activate(0);
        expect(calls).toEqual([]);
    });

    it('activate clamps to the rows', async () => {
        const { session } = await setup(NOTES);
        session.open(null);
        session.activate(99);
        expect(session.active).toBe(2);
    });

    it('land opens the row with the query terms', async () => {
        const { session, calls, files } = await setup(NOTES);
        session.open(null, 'appl');
        session.land(0);
        expect(calls).toEqual([{ method: 'land', file: files.Apple, terms: ['appl'] }]);
    });

    it('land on the current row lands the current note', async () => {
        const { session, calls, files } = await setup(NOTES);
        session.open(files.Banana, 'appl');
        session.land(0);
        expect(calls).toEqual([{ method: 'land', file: files.Banana, terms: ['appl'] }]);
    });

    it('land on the create row creates the note', async () => {
        const { session, calls } = await setup(NOTES);
        session.open(null, ' new idea ');
        session.land(session.rows().length - 1);
        expect(calls).toEqual([{ method: 'create', title: 'new idea' }]);
    });

    it('land defaults to the active row', async () => {
        const { session, calls, files } = await setup(NOTES);
        session.open(null, 'appl');
        session.activate(1);
        calls.length = 0;
        session.land();
        expect(calls).toEqual([{ method: 'land', file: files.Cherry, terms: ['appl'] }]);
    });
});

describe('SearchSession terms', () => {
    it('highlights only positive terms', async () => {
        const { session } = await setup(NOTES);
        session.open(null, 'apple !cherry');
        expect(session.terms()).toEqual(['apple']);
    });

    it('has no terms for an empty query', async () => {
        const { session } = await setup(NOTES);
        session.open(null);
        expect(session.terms()).toEqual([]);
    });
});

describe('SearchSession exact title', () => {
    const NOTES2 = { ...NOTES, 'Apple Pie': 'Apple pie recipe' };

    it('marks the note and narrows to a phrase search', async () => {
        const { session, files } = await setup(NOTES2);
        session.open(files.Banana, 'apple');
        expect(shape(session)).toEqual(['current', 'Apple', 'Apple Pie', 'Cherry', 'create']);
        expect(session.active).toBe(1);

        session.setQuery('  APPLE PIE ');
        expect(shape(session)).toEqual(['current', 'Apple Pie', 'create']);
        expect(session.active).toBe(1);
    });

    it('marks row 0 when no note is pinned', async () => {
        const { session } = await setup(NOTES2);
        session.open(null, 'apple pie');
        expect(session.active).toBe(0);
    });

    it('does not mark without an exact title', async () => {
        const { session } = await setup(NOTES2);
        session.open(null, 'appl');
        expect(session.active).toBe(0);
        expect(session.terms()).toEqual(['appl']);
    });

    it('Go lands the marked row, highlighting only the title', async () => {
        const { session, calls, files } = await setup(NOTES2);
        session.open(files.Banana, 'Apple Pie');
        session.land();
        expect(calls).toEqual([{ method: 'land', file: files['Apple Pie'], terms: ['Apple Pie'] }]);
    });

    it('highlights the whole title rather than the query words', async () => {
        const { session } = await setup(NOTES2);
        session.open(null, 'apple pie');
        expect(session.terms()).toEqual(['Apple Pie']);
    });

    it('skips promotion when the query starts with a quote', async () => {
        const { session, files } = await setup({ ...NOTES2, '"Quoted"': 'x' });
        session.open(files.Banana, '"quoted"');
        expect(session.active).toBe(0);
        expect(session.terms()).toEqual(['quoted']);
    });

    it('drops the mark when the query stops matching exactly', async () => {
        const { session } = await setup(NOTES2);
        session.open(null, 'apple pie');
        session.setQuery('apple pi');
        expect(session.active).toBe(0);
        expect(session.terms()).toEqual(['apple', 'pi']);
    });
});

describe('SearchSession subscribe', () => {
    it('notifies on change until unsubscribed', async () => {
        const { session } = await setup(NOTES);
        const fn = vi.fn();
        const off = session.subscribe(fn);
        session.setQuery('apple');
        expect(fn).toHaveBeenCalledTimes(1);
        off();
        session.setQuery('banana');
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe('SearchSession history', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('merges quick keystrokes into one entry and keeps paused queries apart', async () => {
        const { session } = await setup(NOTES);
        session.open(null);
        session.setQuery('a');
        vi.advanceTimersByTime(100);
        session.setQuery('ap');
        vi.advanceTimersByTime(HISTORY_MERGE_MS + 1);
        session.setQuery('banana');
        expect(session.canBack).toBe(true);
        session.back();
        expect(session.getQuery()).toBe('ap');
        expect(session.canBack).toBe(false);
        expect(session.canForward).toBe(true);
        session.forward();
        expect(session.getQuery()).toBe('banana');
    });

    it('typing after Back starts a fresh entry', async () => {
        const { session } = await setup(NOTES);
        session.open(null, 'apple');
        vi.advanceTimersByTime(HISTORY_MERGE_MS + 1);
        session.setQuery('banana');
        session.back();
        session.setQuery('cherry');
        expect(session.canForward).toBe(false);
        session.back();
        expect(session.getQuery()).toBe('apple');
    });

    it('restores the active row', async () => {
        const { session } = await setup(NOTES);
        session.open(null, 'apple');
        session.activate(1);
        vi.advanceTimersByTime(HISTORY_MERGE_MS + 1);
        session.setQuery('banana');
        session.back();
        expect(session.active).toBe(1);
    });
});

describe('highlightPieces', () => {
    it('flags case-insensitive hits and keeps original case', () => {
        expect(highlightPieces('An Apple pie', ['apple'])).toEqual([
            { text: 'An ', hit: false },
            { text: 'Apple', hit: true },
            { text: ' pie', hit: false },
        ]);
    });

    it('returns the whole text when there are no terms', () => {
        expect(highlightPieces('plain', [])).toEqual([{ text: 'plain', hit: false }]);
    });
});
