/**
 * Search session tests: the real search engine over the obsidian mock and an
 * in-memory vault, with a recording workspace adapter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TFile } from 'obsidian';
import { SearchEngine } from '../src/search-engine';
import { SearchSession, Workspace, HISTORY_MERGE_MS } from '../src/search-session';

// ─── Helpers ─────────────────────────────────────────────────────

function makeFile(basename: string): TFile {
    const file = new (TFile as any)(`${basename}.md`, basename, 'md') as TFile;
    (file as any).parent = null;
    (file as any).stat = { ctime: 0, mtime: 0 };
    return file;
}

/** Workspace adapter that records its calls. */
function recorder() {
    const calls: Array<{ method: string; file?: TFile; terms?: string[]; title?: string; files?: TFile[]; options?: unknown }> = [];
    const workspace: Workspace = {
        preview: (file, terms) => calls.push({ method: 'preview', file, terms }),
        land: (file, terms, options) =>
            calls.push({ method: 'land', file, terms, ...(options?.clearHighlights ? { options } : {}) }),
        create: async (title) => {
            calls.push({ method: 'create', title });
        },
        openFileMenu: (files) => calls.push({ method: 'openFileMenu', files }),
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
    return { session, calls, engine, files: Object.fromEntries(files.map((f) => [f.basename, f])) };
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
    it('activate notifies only when the active row moves', async () => {
        const { session, calls } = await setup(NOTES);
        session.open(null);
        const fn = vi.fn();
        session.subscribe(fn);
        session.activate(0);
        expect(fn).not.toHaveBeenCalled();
        expect(calls.at(-1)?.method).toBe('preview');
        session.step(1);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(session.active).toBe(1);
    });

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

describe('SearchSession land options and re-pinning', () => {
    it('passes land options through to the workspace', async () => {
        const { session, calls } = await setup(NOTES);
        session.open(null, 'apple');
        session.land(0, { clearHighlights: true });
        session.land(0);
        const lands = calls.filter((c) => c.method === 'land');
        expect(lands[0].options).toEqual({ clearHighlights: true });
        expect(lands[1].options).toBeUndefined();
    });

    it('re-pins the current note without rerunning the search or moving the active note', async () => {
        const { session, files } = await setup(NOTES);
        session.open(null, 'apple');
        session.activate(1);
        const before = session.rows()[1];
        session.setCurrentNote(files.Banana);
        expect(session.rows()[0]).toMatchObject({ kind: 'current', file: files.Banana });
        expect(session.rows()[session.active]).toEqual(before);
        expect(session.getQuery()).toBe('apple');
    });

    it('keeps the active note when the pin is dropped or swapped', async () => {
        const { session, files } = await setup(NOTES);
        session.open(files.Banana, 'apple');
        session.activate(2);
        const before = session.rows()[2];
        session.setCurrentNote(null);
        expect(session.rows()[0].kind).toBe('result');
        expect(session.rows()[session.active]).toEqual(before);
        session.setCurrentNote(files.Cherry);
        session.setCurrentNote(files.Apple);
        expect(session.rows()[0]).toMatchObject({ kind: 'current', file: files.Apple });
        expect(session.rows()[session.active]).toEqual(before);
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

describe('SearchSession refresh', () => {
    it('drops a deleted note and the selection once the engine reports it', async () => {
        const { session, engine, files } = await setup(NOTES);
        session.open(null);
        session.toggleSelect(0);
        engine.onNoteRemoved((deleted) => session.refresh(deleted));
        engine.getEventRefs().onDelete(files.Apple);
        expect(shape(session)).toEqual(['Banana', 'Cherry']);
        expect(session.isSelecting).toBe(false);
        expect(session.selectionCount).toBe(0);
    });

    it('unpins the current note when it is the one deleted', async () => {
        const { session, engine, files } = await setup(NOTES);
        session.open(files.Banana);
        engine.onNoteRemoved((deleted) => session.refresh(deleted));
        engine.getEventRefs().onDelete(files.Apple);
        expect(shape(session)).toEqual(['current', 'Banana', 'Cherry']);
        engine.getEventRefs().onDelete(files.Banana);
        expect(shape(session)).toEqual(['Cherry']);
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

describe('SearchSession selection', () => {
    it('toggles a note in and out, entering and keeping selection mode', async () => {
        const { session, files } = await setup(NOTES);
        session.open(null);
        expect(session.isSelecting).toBe(false);
        session.toggleSelect(1);
        expect(session.isSelecting).toBe(true);
        expect(session.isSelected(1)).toBe(true);
        expect(session.targetFiles()).toEqual([files.Banana]);
        session.toggleSelect(1);
        expect(session.isSelected(1)).toBe(false);
        expect(session.selectionCount).toBe(0);
        expect(session.isSelecting).toBe(true);
    });

    it('notifies subscribers on every selection change', async () => {
        const { session } = await setup(NOTES);
        session.open(null);
        const listener = vi.fn();
        session.subscribe(listener);
        session.beginSelect();
        session.toggleSelect(0);
        session.selectAll();
        session.clearSelection();
        expect(listener).toHaveBeenCalledTimes(4);
    });

    it('selects every note once, skipping the create row and the duplicate of the current note', async () => {
        const { session, files } = await setup(NOTES);
        session.open(files.Apple, 'a');
        session.selectAll();
        expect(session.targetFiles()).toEqual([files.Apple, files.Banana, files.Cherry]);
        expect(session.selectionCount).toBe(3);
        expect(session.isSelected(session.rows().length - 1)).toBe(false);
    });

    it('selecting the current note row selects its result row too', async () => {
        const { session, files } = await setup(NOTES);
        session.open(files.Apple);
        session.toggleSelect(0);
        expect(session.isSelected(0)).toBe(true);
        expect(session.isSelected(1)).toBe(true);
        expect(session.targetFiles()).toEqual([files.Apple]);
    });

    it('ignores the create row', async () => {
        const { session } = await setup(NOTES);
        session.open(null, 'nothing matches this');
        session.toggleSelect(0);
        expect(session.isSelecting).toBe(false);
        expect(session.selectionCount).toBe(0);
    });

    it('clears the selection and leaves selection mode', async () => {
        const { session } = await setup(NOTES);
        session.open(null);
        session.selectAll();
        session.clearSelection();
        expect(session.isSelecting).toBe(false);
        expect(session.selectionCount).toBe(0);
    });

    it('targets the selection in list order, not click order', async () => {
        const { session, files } = await setup(NOTES);
        session.open(null);
        session.toggleSelect(2);
        session.toggleSelect(0);
        expect(session.targetFiles()).toEqual([files.Apple, files.Cherry]);
    });

    it('falls back to the active note when nothing is selected', async () => {
        const { session, files } = await setup(NOTES);
        session.open(null);
        expect(session.targetFiles()).toEqual([files.Apple]);
        session.activate(2);
        expect(session.targetFiles()).toEqual([files.Cherry]);
        session.beginSelect();
        expect(session.targetFiles()).toEqual([files.Cherry]);
    });

    it('has no target when the active row is the create row', async () => {
        const { session } = await setup(NOTES);
        session.open(null, 'nothing matches this');
        expect(session.targetFiles()).toEqual([]);
    });

    it('drops the selection when the query changes', async () => {
        const { session } = await setup(NOTES);
        session.open(null);
        session.selectAll();
        session.setQuery('apple');
        expect(session.isSelecting).toBe(false);
        expect(session.selectionCount).toBe(0);
    });

    it('selects a range in either direction, skipping the create row', async () => {
        const { session, files } = await setup(NOTES);
        session.open(null, 'a');
        expect(session.rows().at(-1)?.kind).toBe('create');
        session.selectRange(2, 0);
        expect(session.isSelecting).toBe(true);
        expect(session.targetFiles()).toEqual([files.Apple, files.Banana, files.Cherry]);
        session.clearSelection();
        session.selectRange(1, 99);
        expect(session.targetFiles()).toEqual([files.Banana, files.Cherry]);
    });

    it('adds a range to what is already selected', async () => {
        const { session, files } = await setup(NOTES);
        session.open(null);
        session.toggleSelect(0);
        session.selectRange(1, 2);
        expect(session.targetFiles()).toEqual([files.Apple, files.Banana, files.Cherry]);
    });

    it('extends the selection with the active row without previewing', async () => {
        const { session, calls, files } = await setup(NOTES);
        session.open(null);
        session.extendSelection(1);
        expect(session.active).toBe(1);
        expect(session.targetFiles()).toEqual([files.Apple, files.Banana]);
        session.extendSelection(1);
        expect(session.targetFiles()).toEqual([files.Apple, files.Banana, files.Cherry]);
        session.extendSelection(5);
        expect(session.active).toBe(2);
        expect(calls.filter((c) => c.method === 'preview')).toEqual([]);
    });

    it('opens the file menu for the targets at the given position', async () => {
        const { session, calls, files } = await setup(NOTES);
        session.open(null);
        session.toggleSelect(0);
        session.toggleSelect(1);
        session.openFileMenu({ x: 1, y: 2 });
        expect(calls.at(-1)).toEqual({ method: 'openFileMenu', files: [files.Apple, files.Banana] });
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

describe('SearchSession history details', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('never pushes an identical query twice', async () => {
        const { session } = await setup(NOTES);
        session.open(null, 'apple');
        vi.advanceTimersByTime(HISTORY_MERGE_MS + 1);
        session.setQuery('apple ');
        expect(session.canBack).toBe(false);
        expect(session.recentQueries()).toEqual(['apple']);
    });

    it('back and forward notify subscribers once and do nothing at the ends', async () => {
        const { session } = await setup(NOTES);
        session.open(null, 'apple');
        vi.advanceTimersByTime(HISTORY_MERGE_MS + 1);
        session.setQuery('banana');
        const fn = vi.fn();
        session.subscribe(fn);
        session.forward();
        expect(fn).not.toHaveBeenCalled();
        session.back();
        expect(fn).toHaveBeenCalledTimes(1);
        session.back();
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('keeps history when the session is reopened', async () => {
        const { session } = await setup(NOTES);
        session.open(null, 'apple');
        vi.advanceTimersByTime(HISTORY_MERGE_MS + 1);
        session.setQuery('banana');
        session.open(null);
        expect(session.getQuery()).toBe('');
        session.setQuery('cherry');
        expect(session.recentQueries()).toEqual(['cherry', 'banana', 'apple']);
        session.back();
        expect(session.getQuery()).toBe('banana');
    });

    it('Back from a blank field returns to the query just left', async () => {
        const { session } = await setup(NOTES);
        session.open(null, 'apple');
        vi.advanceTimersByTime(HISTORY_MERGE_MS + 1);
        session.setQuery('banana');
        session.open(null);
        expect(session.canBack).toBe(true);
        session.back();
        expect(session.getQuery()).toBe('banana');
        session.back();
        expect(session.getQuery()).toBe('apple');
    });

    it('Back works from a blank field with a single entry', async () => {
        const { session } = await setup(NOTES);
        session.open(null, 'apple');
        session.setQuery('');
        expect(session.canBack).toBe(true);
        session.back();
        expect(session.getQuery()).toBe('apple');
        expect(session.canBack).toBe(false);
    });

    it('activating a row in a blank field leaves the history entry alone', async () => {
        const { session } = await setup(NOTES);
        session.open(null, 'apple');
        session.activate(1);
        vi.advanceTimersByTime(HISTORY_MERGE_MS + 1);
        session.open(null);
        session.activate(2);
        session.back();
        expect(session.getQuery()).toBe('apple');
        expect(session.active).toBe(1);
    });

    it('clearing the field and retyping quickly starts a fresh entry', async () => {
        const { session } = await setup(NOTES);
        session.open(null, 'apple');
        session.setQuery('');
        session.setQuery('banana');
        expect(session.recentQueries()).toEqual(['banana', 'apple']);
    });

    it('lists recents most recent first, distinct, capped', async () => {
        const { session } = await setup(NOTES);
        session.open(null);
        for (const q of ['a1', 'b1', 'a1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1', 'i1']) {
            session.setQuery(q);
            vi.advanceTimersByTime(HISTORY_MERGE_MS + 1);
        }
        expect(session.recentQueries()).toEqual(['i1', 'h1', 'g1', 'f1', 'e1', 'd1', 'c1', 'a1']);
    });

    it('rerunning a recent query searches it', async () => {
        const { session } = await setup(NOTES);
        session.open(null, 'banana');
        session.setQuery('');
        session.setQuery(session.recentQueries()[0]);
        expect(shape(session)).toEqual(['Banana', 'create']);
    });
});
