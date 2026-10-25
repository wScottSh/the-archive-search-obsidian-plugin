/**
 * Search session: everything about a search except rendering.
 *
 * Owns the query, the rows built from it, the active row, highlight terms and
 * query history. Views drive it and re-render when it notifies; it talks to
 * Obsidian only through the `Workspace` seam, so tests can swap in a recorder.
 */

import type { TFile } from 'obsidian';
import type { SearchResult, SnippetPiece } from './search-engine';
import { parseQuery } from './parser';
import { extractSearchTerms } from './editor-highlight';

// ─── Rows ────────────────────────────────────────────────────────

export type Row =
    | { kind: 'current'; file: TFile }
    | { kind: 'result'; file: TFile; result: SearchResult }
    | { kind: 'create'; title: string };

// ─── Workspace seam ──────────────────────────────────────────────

export interface Workspace {
    /** Show the file in the editor without leaving search. */
    preview(file: TFile, terms: string[]): void;
    /** Open the file with matches highlighted, cursor at the first match, editor focused. */
    land(file: TFile, terms: string[]): void;
    /** Create the note in the configured location, or open it if it already exists. */
    create(title: string): Promise<void>;
    /** Show Obsidian's file menu for the files at a screen position. */
    openFileMenu(files: TFile[], position: { x: number; y: number }): void;
}

/** The part of the search engine a session needs. */
export interface Searcher {
    search(query: string): SearchResult[];
}

// ─── History ─────────────────────────────────────────────────────

/** How many recent queries `recents()` offers. */
export const RECENT_LIMIT = 8;

/** A query change within this window of the last push replaces that entry. */
export const HISTORY_MERGE_MS = 1200;

interface HistoryEntry {
    query: string;
    active: number;
    at: number;
}

// ─── Session ─────────────────────────────────────────────────────

export class SearchSession {
    private query = '';
    private results: SearchResult[] = [];
    private currentNote: TFile | null = null;
    private activeIndex = 0;
    /** Title of the note the query names exactly; highlighting is locked to it. */
    private exactTitle: string | null = null;
    private history: HistoryEntry[] = [];
    private historyPos = -1;
    private listeners = new Set<() => void>();
    private selecting = false;
    private selected = new Set<TFile>();

    constructor(private engine: Searcher, private workspace: Workspace) {}

    subscribe(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => {
            this.listeners.delete(fn);
        };
    }

    private emit(): void {
        this.listeners.forEach((fn) => fn());
    }

    /** Start (or restart) a search, pinning the note the user came from. */
    open(currentNote: TFile | null, query = ''): void {
        this.currentNote = currentNote;
        this.query = query;
        // A reopened search starts a fresh entry rather than merging into the last one
        const top = this.history[this.historyPos];
        if (top) top.at = 0;
        this.run(true);
    }

    getQuery(): string {
        return this.query;
    }

    setQuery(query: string): void {
        if (query === this.query) return;
        this.query = query;
        this.run(true);
    }

    /** Current note first, then results in sort order, then the create row for a non-blank query. */
    rows(): Row[] {
        const rows: Row[] = [];
        if (this.currentNote) rows.push({ kind: 'current', file: this.currentNote });
        for (const result of this.results) rows.push({ kind: 'result', file: result.file, result });
        const title = this.query.trim();
        if (title) rows.push({ kind: 'create', title });
        return rows;
    }

    get active(): number {
        return this.activeIndex;
    }

    /** Words to highlight for a row: the whole title when the query names a note exactly, else the query's positive terms. */
    terms(_index = this.activeIndex): string[] {
        if (this.exactTitle) return [this.exactTitle];
        return extractSearchTerms(parseQuery(this.query.trim()));
    }

    /** Make a row active and preview it without leaving search. */
    activate(index: number): void {
        const rows = this.rows();
        if (rows.length === 0) return;
        this.activeIndex = Math.max(0, Math.min(rows.length - 1, index));
        const row = rows[this.activeIndex];
        if (row.kind !== 'create') this.workspace.preview(row.file, this.terms(this.activeIndex));
        const entry = this.history[this.historyPos];
        if (entry) entry.active = this.activeIndex;
        this.emit();
    }

    /** Commit to a row: open its note, or create the note for the create row. */
    land(index = this.activeIndex): void {
        const row = this.rows()[index];
        if (!row) return;
        if (row.kind === 'create') void this.workspace.create(row.title);
        else this.workspace.land(row.file, this.terms(index));
    }

    // ── Selection ──

    /** Whether the session is in selection mode (rows show checkboxes). */
    get isSelecting(): boolean {
        return this.selecting;
    }

    get selectionCount(): number {
        return this.selected.size;
    }

    /** Enter selection mode with nothing selected. */
    beginSelect(): void {
        this.selecting = true;
        this.emit();
    }

    /** Whether the row's note is selected. Rows for the same note share one selection. */
    isSelected(index: number): boolean {
        const row = this.rows()[index];
        return !!row && row.kind !== 'create' && this.selected.has(row.file);
    }

    /** Flip a row's note in or out of the selection, entering selection mode. The create row is not selectable. */
    toggleSelect(index: number): void {
        const row = this.rows()[index];
        if (!row || row.kind === 'create') return;
        this.selecting = true;
        if (!this.selected.delete(row.file)) this.selected.add(row.file);
        this.emit();
    }

    /** Select every note in the list, entering selection mode. */
    selectAll(): void {
        this.selecting = true;
        for (const file of this.listedFiles()) this.selected.add(file);
        this.emit();
    }

    /** Select every note between two rows, inclusive, entering selection mode. The create row is skipped. */
    selectRange(from: number, to: number): void {
        const rows = this.rows();
        const start = Math.max(0, Math.min(from, to));
        const end = Math.min(rows.length - 1, Math.max(from, to));
        this.selecting = true;
        for (let i = start; i <= end; i++) {
            const row = rows[i];
            if (row.kind !== 'create') this.selected.add(row.file);
        }
        this.emit();
    }

    /** Move the active row by `delta` without previewing it, selecting every note passed over, the starting row included. */
    extendSelection(delta: number): void {
        const rows = this.rows();
        if (rows.length === 0) return;
        const from = this.activeIndex;
        this.activeIndex = Math.max(0, Math.min(rows.length - 1, from + delta));
        const entry = this.history[this.historyPos];
        if (entry) entry.active = this.activeIndex;
        this.selectRange(from, this.activeIndex);
    }

    /** Drop the selection and leave selection mode. */
    clearSelection(): void {
        this.selecting = false;
        this.selected.clear();
        this.emit();
    }

    /** The notes an action applies to: the selection in list order, else the active row's note. */
    targetFiles(): TFile[] {
        if (this.selected.size > 0) return this.listedFiles().filter((file) => this.selected.has(file));
        const row = this.rows()[this.activeIndex];
        return row && row.kind !== 'create' ? [row.file] : [];
    }

    /** Show Obsidian's file menu for the target notes. */
    openFileMenu(position: { x: number; y: number }): void {
        this.workspace.openFileMenu(this.targetFiles(), position);
    }

    private listedFiles(): TFile[] {
        const files = new Set<TFile>();
        for (const row of this.rows()) if (row.kind !== 'create') files.add(row.file);
        return [...files];
    }

    // ── History ──

    get canBack(): boolean {
        return this.historyPos > 0;
    }

    get canForward(): boolean {
        return this.historyPos < this.history.length - 1;
    }

    back(): void {
        if (this.canBack) this.restore(this.historyPos - 1);
    }

    forward(): void {
        if (this.canForward) this.restore(this.historyPos + 1);
    }

    /** Distinct queries the user paused on, most recent first. */
    recents(): string[] {
        const seen = new Set<string>();
        const queries: string[] = [];
        for (let i = this.history.length - 1; i >= 0 && queries.length < RECENT_LIMIT; i--) {
            const query = this.history[i].query.trim();
            if (query && !seen.has(query)) {
                seen.add(query);
                queries.push(query);
            }
        }
        return queries;
    }

    private restore(pos: number): void {
        this.historyPos = pos;
        const entry = this.history[pos];
        this.query = entry.query;
        this.search();
        this.activeIndex = Math.min(entry.active, Math.max(0, this.rows().length - 1));
        // Typing after Back starts a fresh entry rather than merging into this one
        entry.at = 0;
        this.emit();
    }

    private pushHistory(): void {
        const now = Date.now();
        if (this.historyPos < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyPos + 1);
        }
        const top = this.history[this.historyPos];
        if (top && top.query.trim() === this.query.trim()) return;
        if (top && now - top.at < HISTORY_MERGE_MS) {
            top.query = this.query;
            top.active = this.activeIndex;
            top.at = now;
        } else {
            this.history.push({ query: this.query, active: this.activeIndex, at: now });
            this.historyPos = this.history.length - 1;
        }
    }

    /**
     * A bare query equal to a note's title (case-insensitive) narrows to a phrase
     * search and marks that note, as the desktop omnibar does. A leading quote opts out.
     */
    private promoteExactTitle(): void {
        const title = this.query.trim();
        if (!title || this.query.startsWith('"')) return;
        const isExact = (r: SearchResult) => r.filename.toLowerCase() === title.toLowerCase();
        if (!this.results.some(isExact)) return;

        this.results = this.engine.search(`"${title}"`);
        const index = this.results.findIndex(isExact);
        if (index === -1) {
            this.results = this.engine.search(this.query);
            return;
        }
        this.exactTitle = this.results[index].filename;
        this.activeIndex = index + (this.currentNote ? 1 : 0);
    }

    private search(): void {
        this.results = this.engine.search(this.query);
        this.activeIndex = 0;
        this.exactTitle = null;
        this.promoteExactTitle();
        // The list changed under the selection
        this.selecting = false;
        this.selected.clear();
    }

    private run(record: boolean): void {
        this.search();
        if (record && this.query.trim()) this.pushHistory();
        this.emit();
    }
}

// ─── Highlighting ────────────────────────────────────────────────

/** Split text into pieces, flagging case-insensitive occurrences of any term. */
export function highlightPieces(text: string, terms: string[]): SnippetPiece[] {
    const needles = terms.map((t) => t.toLowerCase()).filter(Boolean);
    const lower = text.toLowerCase();
    // Lowercasing can change length for a few characters; offsets would no longer line up
    if (needles.length === 0 || lower.length !== text.length) return [{ text, hit: false }];

    const pieces: SnippetPiece[] = [];
    let cursor = 0;
    while (cursor < text.length) {
        let start = -1;
        let length = 0;
        for (const needle of needles) {
            const pos = lower.indexOf(needle, cursor);
            if (pos !== -1 && (start === -1 || pos < start || (pos === start && needle.length > length))) {
                start = pos;
                length = needle.length;
            }
        }
        if (start === -1) break;
        if (start > cursor) pieces.push({ text: text.substring(cursor, start), hit: false });
        pieces.push({ text: text.substring(start, start + length), hit: true });
        cursor = start + length;
    }
    if (cursor < text.length) pieces.push({ text: text.substring(cursor), hit: false });
    return pieces;
}
