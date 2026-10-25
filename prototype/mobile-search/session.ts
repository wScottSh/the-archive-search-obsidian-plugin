// PROTOTYPE — search state shared by all variants. Mirrors OmnibarView's desktop semantics
// (pinned current note, exact-title promotion, create row, multi-select, nav stack) so every
// variant gets full parity and only the *rendering* differs.

import { TFile } from 'obsidian';
import { SearchEngine, SearchResult } from '../../src/search-engine';
import { parseQuery } from '../../src/parser';
import { extractSearchTerms } from '../../src/editor-highlight';

export type Row =
    | { kind: 'current'; file: TFile }
    | { kind: 'result'; file: TFile; result: SearchResult }
    | { kind: 'create'; title: string };

export type FileAction =
    | 'open-tab'
    | 'insert-link'
    | 'copy-link'
    | 'bookmark'
    | 'rename'
    | 'move'
    | 'delete';

export const FILE_ACTIONS: { id: FileAction; label: string; icon: string; danger?: boolean; single?: boolean }[] = [
    { id: 'open-tab', label: 'Open in new tab', icon: 'external-link', single: true },
    { id: 'insert-link', label: 'Insert link at cursor', icon: 'link' },
    { id: 'copy-link', label: 'Copy link', icon: 'copy' },
    { id: 'bookmark', label: 'Bookmark', icon: 'bookmark' },
    { id: 'rename', label: 'Rename…', icon: 'pencil', single: true },
    { id: 'move', label: 'Move to…', icon: 'folder' },
    { id: 'delete', label: 'Delete', icon: 'trash-2', danger: true },
];

/** Services the surrounding app (Obsidian, or the prototype harness) provides. */
export interface Host {
    read(file: TFile): string;
    /** Show the file in the editor *without* leaving search (desktop arrow-key browse). */
    preview(file: TFile, terms: string[]): void;
    /** Open the file, cursor at first match, and close search (desktop Enter). */
    land(file: TFile, terms: string[]): void;
    create(title: string): void;
    close(): void;
    toast(msg: string): void;
    act(action: FileAction, files: TFile[]): void;
}

interface NavEntry {
    query: string;
    active: number;
    at: number;
}

export interface Segment {
    text: string;
    hit: boolean;
}

export class SearchSession {
    query = '';
    results: SearchResult[] = [];
    exactFilenameTerm: string | null = null;
    currentNote: TFile | null = null;
    /** Index into rows(): the row being previewed (desktop: arrow-key selection). */
    active = 0;
    selecting = false;
    selected = new Set<string>();
    navStack: NavEntry[] = [];
    navPos = -1;
    lastAction = 'init';

    private listeners = new Set<() => void>();

    constructor(private engine: SearchEngine, readonly host: Host) {}

    subscribe(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    private emit(action: string): void {
        this.lastAction = action;
        this.listeners.forEach((fn) => fn());
    }

    /** Called each time search opens (toolbar button, wiki-link, hashtag). */
    open(currentNote: TFile | null, query?: string): void {
        this.currentNote = currentNote;
        this.selecting = false;
        this.selected.clear();
        if (query !== undefined) this.query = query;
        this.run(query !== undefined);
    }

    setQuery(query: string): void {
        if (query === this.query) return;
        this.query = query;
        this.run(true);
    }

    get offset(): number {
        return this.currentNote ? 1 : 0;
    }

    rows(): Row[] {
        const rows: Row[] = [];
        if (this.currentNote) rows.push({ kind: 'current', file: this.currentNote });
        for (const r of this.results) rows.push({ kind: 'result', file: r.file, result: r });
        const t = this.query.trim();
        if (t) rows.push({ kind: 'create', title: t });
        return rows;
    }

    private run(push: boolean): void {
        const q = this.query;
        const t = q.trim();
        this.results = this.engine.search(q);
        this.active = 0;
        this.selected.clear();
        this.selecting = false;
        this.exactFilenameTerm = null;

        if (t && !q.startsWith('"')) {
            const lower = t.toLowerCase();
            const hit = this.results.find((r) => r.filename.toLowerCase() === lower);
            if (hit) {
                this.exactFilenameTerm = hit.filename;
                this.results = this.engine.search(`"${t}"`);
                const idx = this.results.findIndex((r) => r.filename.toLowerCase() === lower);
                if (idx !== -1) this.active = idx + this.offset;
            }
        }

        if (push && t) this.pushNav();
        this.emit('search');
    }

    /** Highlight terms for a row, using desktop's exact-title rules. */
    terms(index = this.active): string[] {
        const t = this.query.trim();
        if (!t) return [];
        if (this.exactFilenameTerm) return [this.exactFilenameTerm];
        const row = this.rows()[index];
        if (row?.kind === 'result' && row.result.filename.toLowerCase() === t.toLowerCase()) {
            return [row.result.filename];
        }
        return extractSearchTerms(parseQuery(t));
    }

    fileAt(index: number): TFile | null {
        const row = this.rows()[index];
        return row && row.kind !== 'create' ? row.file : null;
    }

    /** Preview a row (desktop: click / arrow-key). Does not leave search. */
    activate(index: number): void {
        const rows = this.rows();
        this.active = Math.max(0, Math.min(rows.length - 1, index));
        const file = this.fileAt(this.active);
        if (file) this.host.preview(file, this.terms());
        if (this.navStack[this.navPos]) this.navStack[this.navPos].active = this.active;
        this.emit('activate');
    }

    step(delta: number): void {
        this.activate(this.active + delta);
    }

    /** Commit to a row (desktop: Enter). */
    land(index = this.active): void {
        const row = this.rows()[index];
        if (!row) return;
        if (row.kind === 'create') this.host.create(row.title);
        else this.host.land(row.file, this.terms(index));
        this.emit('land');
    }

    // ── Multi-select (desktop: ctrl/shift-click, shift-arrow) ──

    toggleSelect(path: string): void {
        if (this.selected.has(path)) this.selected.delete(path);
        else this.selected.add(path);
        this.selecting = this.selected.size > 0;
        this.emit('select');
    }

    startSelecting(): void {
        this.selecting = true;
        this.emit('select');
    }

    selectAll(): void {
        this.selecting = true;
        for (const r of this.results) this.selected.add(r.file.path);
        this.emit('select');
    }

    clearSelection(): void {
        this.selected.clear();
        this.selecting = false;
        this.emit('select');
    }

    /** Files an action applies to: the multi-selection, else the active row. */
    targetFiles(): TFile[] {
        if (this.selected.size > 0) {
            return this.results.filter((r) => this.selected.has(r.file.path)).map((r) => r.file);
        }
        const f = this.fileAt(this.active);
        return f ? [f] : [];
    }

    act(action: FileAction, files = this.targetFiles()): void {
        if (files.length === 0) return;
        this.host.act(action, files);
        this.clearSelection();
    }

    // ── Navigation stack ──
    // Deviation from desktop: desktop pushes one entry per keystroke, so Back walks
    // backwards one letter at a time. Here, typing within 1.2s of the last push
    // replaces the top entry, so each entry is a query the user actually paused on.

    private pushNav(): void {
        const now = Date.now();
        if (this.navPos < this.navStack.length - 1) {
            this.navStack = this.navStack.slice(0, this.navPos + 1);
        }
        const top = this.navStack[this.navPos];
        if (top && top.query.trim() === this.query.trim()) return;
        if (top && now - top.at < 1200) {
            top.query = this.query;
            top.active = this.active;
            top.at = now;
        } else {
            this.navStack.push({ query: this.query, active: this.active, at: now });
            this.navPos = this.navStack.length - 1;
        }
    }

    get canBack(): boolean {
        return this.navPos > 0;
    }

    get canForward(): boolean {
        return this.navPos < this.navStack.length - 1;
    }

    back(): void {
        if (!this.canBack) return;
        this.navPos--;
        this.restore();
    }

    forward(): void {
        if (!this.canForward) return;
        this.navPos++;
        this.restore();
    }

    private restore(): void {
        const entry = this.navStack[this.navPos];
        this.query = entry.query;
        this.run(false);
        this.active = Math.min(entry.active, this.rows().length - 1);
        this.navStack[this.navPos].at = 0; // typing after Back starts a fresh entry
        this.emit('nav');
    }

    /** Distinct past queries, most recent first (for an empty-state "recent" list). */
    recentQueries(limit = 8): string[] {
        const seen = new Set<string>();
        const out: string[] = [];
        for (let i = this.navStack.length - 1; i >= 0 && out.length < limit; i--) {
            const q = this.navStack[i].query.trim();
            if (q && !seen.has(q.toLowerCase())) {
                seen.add(q.toLowerCase());
                out.push(q);
            }
        }
        return out;
    }

    // ── Display helpers ──

    /**
     * Case-preserving snippet around the first match, split into hit / non-hit segments.
     * (The engine's own `result.snippet` is cut from the lowercased index, so it renders lowercase.)
     */
    snippet(file: TFile, terms = this.terms(), radius = 60): Segment[] | null {
        if (terms.length === 0) return null;
        const body = stripMarkdown(this.host.read(file));
        const lower = body.toLowerCase();
        let first = -1;
        for (const term of terms) {
            const p = lower.indexOf(term.toLowerCase());
            if (p !== -1 && (first === -1 || p < first)) first = p;
        }
        if (first === -1) return null;
        let start = Math.max(0, first - radius);
        if (start > 0) {
            const space = body.indexOf(' ', start);
            if (space !== -1 && space < first) start = space + 1;
        }
        const end = Math.min(body.length, first + radius * 2);
        const text = (start > 0 ? '…' : '') + body.substring(start, end).trim() + (end < body.length ? '…' : '');
        return highlight(text, terms);
    }
}

/** Split text into segments, marking case-insensitive occurrences of any term. */
export function highlight(text: string, terms: string[]): Segment[] {
    const needles = terms.map((t) => t.toLowerCase()).filter(Boolean);
    if (needles.length === 0) return [{ text, hit: false }];
    const lower = text.toLowerCase();
    const out: Segment[] = [];
    let i = 0;
    while (i < text.length) {
        let best = -1;
        let len = 0;
        for (const n of needles) {
            const p = lower.indexOf(n, i);
            if (p !== -1 && (best === -1 || p < best || (p === best && n.length > len))) {
                best = p;
                len = n.length;
            }
        }
        if (best === -1) {
            out.push({ text: text.substring(i), hit: false });
            break;
        }
        if (best > i) out.push({ text: text.substring(i, best), hit: false });
        out.push({ text: text.substring(best, best + len), hit: true });
        i = best + len;
    }
    return out;
}

/** Append highlighted segments to an element as text + <mark> nodes. */
export function renderSegments(el: HTMLElement, segs: Segment[]): void {
    for (const s of segs) {
        if (s.hit) el.createEl('mark', { cls: 'tas-hit', text: s.text });
        else el.appendText(s.text);
    }
}

function stripMarkdown(md: string): string {
    return md
        .replace(/^#+ .*$/m, '')
        .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
        .replace(/[*_`>]/g, '')
        .replace(/^\s*[-\d.]+\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
}
