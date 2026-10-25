/**
 * Search engine that indexes the vault and evaluates parsed boolean queries.
 *
 * - Builds an in-memory index of filename + content (case-folded for case-insensitive search)
 * - Listens to vault events for incremental updates
 * - Evaluates an AST against the index to produce sorted results
 * - Supports folder exclusion and respecting Obsidian's native excluded files
 */

import { App, TFile, TAbstractFile, debounce } from 'obsidian';
import { parseQuery, SearchNode } from './parser';
import { extractSearchTerms } from './editor-highlight';
import type { SortOrder, ArchiveSearchSettings } from './settings';

// ─── Index Entry ─────────────────────────────────────────────────

export interface IndexEntry {
    file: TFile;
    filename: string;      // case-folded basename (no extension)
    content: string;       // case-folded full text content, same length as rawContent
    rawContent: string;    // original-case full text content (for snippets)
    rawFilename: string;   // original-case basename (no extension)
}

// ─── Snippet Piece ───────────────────────────────────────────────

/** A run of snippet text in original case; `hit` marks a search-term match. */
export interface SnippetPiece {
    text: string;
    hit: boolean;
}

/**
 * Lowercase without changing length, so offsets into the result are offsets
 * into `text`. The few characters whose lowercase is longer (Turkish `İ`) keep
 * their case.
 */
export function foldCase(text: string): string {
    const lower = text.toLowerCase();
    if (lower.length === text.length) return lower;
    let folded = '';
    for (const char of text) {
        const lowerChar = char.toLowerCase();
        folded += lowerChar.length === char.length ? lowerChar : char;
    }
    return folded;
}

/**
 * Split text into pieces, flagging case-insensitive matches of any term.
 * Overlapping matches become adjacent hit pieces; at equal starts the longest wins.
 */
export function highlightPieces(text: string, terms: string[]): SnippetPiece[] {
    const folded = foldCase(text);
    const ranges: Array<[number, number]> = [];
    for (const term of terms) {
        const t = foldCase(term);
        if (!t) continue;
        for (let pos = folded.indexOf(t); pos !== -1; pos = folded.indexOf(t, pos + t.length)) {
            ranges.push([pos, pos + t.length]);
        }
    }
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);

    const pieces: SnippetPiece[] = [];
    let cursor = 0;
    for (const [rs, re] of ranges) {
        if (re <= cursor) continue;
        const hs = Math.max(rs, cursor);
        if (hs > cursor) pieces.push({ text: text.substring(cursor, hs), hit: false });
        pieces.push({ text: text.substring(hs, re), hit: true });
        cursor = re;
    }
    if (cursor < text.length || pieces.length === 0) pieces.push({ text: text.substring(cursor), hit: false });
    return pieces;
}

// ─── Search Result ───────────────────────────────────────────────

export interface SearchResult {
    file: TFile;
    filename: string;         // original-case basename
    matchInFilename: boolean; // true if any search term matched in the filename
    snippet?: SnippetPiece[]; // original-case pieces, hits flagged
}

// ─── Search Engine ───────────────────────────────────────────────

export class SearchEngine {
    private app: App;
    private settings: ArchiveSearchSettings;
    private index: Map<string, IndexEntry> = new Map();
    private _ready = false;
    private removalListeners = new Set<() => void>();

    constructor(app: App, settings: ArchiveSearchSettings) {
        this.app = app;
        this.settings = settings;
    }

    get ready(): boolean {
        return this._ready;
    }

    /** Update settings reference (called when settings change). */
    updateSettings(settings: ArchiveSearchSettings): void {
        this.settings = settings;
    }

    /**
     * Build the full index from all markdown files in the vault.
     * Call this once on layout ready.
     */
    async buildIndex(): Promise<void> {
        this.index.clear();
        const files = this.app.vault.getMarkdownFiles();
        for (const file of files) {
            if (!this.isExcluded(file)) {
                await this.indexFile(file);
            }
        }
        this._ready = true;
    }

    /**
     * Rebuild the index (e.g. after exclusion settings change).
     */
    async rebuildIndex(): Promise<void> {
        await this.buildIndex();
    }

    /**
     * Check whether a file should be excluded from indexing.
     */
    private isExcluded(file: TFile): boolean {
        // Plugin-specific folder exclusions
        for (const folder of this.settings.excludedFolders) {
            if (folder && file.path.startsWith(folder + '/')) {
                return true;
            }
            // Also match exact folder name at root
            if (folder && file.path.startsWith(folder + '/')) {
                return true;
            }
        }

        // Respect Obsidian's native excluded files
        if (this.settings.respectObsidianExcluded) {
            try {
                const filters = (this.app.vault as any).config?.userIgnoreFilters;
                if (Array.isArray(filters)) {
                    for (const pattern of filters) {
                        if (typeof pattern === 'string' && pattern) {
                            // Simple path prefix or exact match
                            if (file.path.startsWith(pattern) || file.path === pattern) {
                                return true;
                            }
                            // Check if it's a folder pattern (no extension)
                            if (!pattern.includes('.') && file.path.startsWith(pattern + '/')) {
                                return true;
                            }
                        }
                    }
                }
            } catch {
                // Internal API — fail silently
            }
        }

        return false;
    }

    /**
     * Call `fn` once the index has caught up with a deleted or renamed note,
     * so an open list can drop the stale row. Returns an unsubscribe.
     */
    onNoteRemoved(fn: () => void): () => void {
        this.removalListeners.add(fn);
        return () => {
            this.removalListeners.delete(fn);
        };
    }

    private noteRemoved(): void {
        this.removalListeners.forEach((fn) => fn());
    }

    /**
     * Register vault event listeners for incremental index updates.
     * Returns an object of event handlers for cleanup via plugin.registerEvent().
     */
    getEventRefs() {
        const debouncedModify = debounce(
            async (file: TAbstractFile) => {
                if (file instanceof TFile && file.extension === 'md') {
                    if (this.isExcluded(file)) {
                        this.index.delete(file.path);
                    } else {
                        await this.indexFile(file);
                    }
                }
            },
            500,
            true
        );

        return {
            onCreate: async (file: TAbstractFile) => {
                if (file instanceof TFile && file.extension === 'md') {
                    if (!this.isExcluded(file)) {
                        await this.indexFile(file);
                    }
                }
            },
            onModify: debouncedModify,
            onDelete: (file: TAbstractFile) => {
                this.index.delete(file.path);
                this.noteRemoved();
            },
            onRename: async (file: TAbstractFile, oldPath: string) => {
                this.index.delete(oldPath);
                if (file instanceof TFile && file.extension === 'md') {
                    if (!this.isExcluded(file)) {
                        await this.indexFile(file);
                    }
                }
                this.noteRemoved();
            },
        };
    }

    /**
     * Index a single file: read its content and store in the map.
     */
    private async indexFile(file: TFile): Promise<void> {
        try {
            const content = await this.app.vault.cachedRead(file);
            const basename = file.basename;
            this.index.set(file.path, {
                file,
                filename: foldCase(basename),
                content: foldCase(content),
                rawContent: content,
                rawFilename: basename,
            });
        } catch {
            // File may have been deleted between events; ignore
        }
    }

    /**
     * Execute a search query and return sorted results.
     */
    search(query: string): SearchResult[] {
        const ast = parseQuery(query);
        if (!ast) {
            // Empty/invalid query: return all files
            return this.allFilesSorted();
        }

        const results: SearchResult[] = [];
        const queryLower = foldCase(query);
        const positiveTerms = extractSearchTerms(ast);

        for (const entry of this.index.values()) {
            if (this.evaluate(ast, entry)) {
                results.push({
                    file: entry.file,
                    filename: entry.rawFilename,
                    matchInFilename: entry.filename.includes(queryLower),
                    snippet: this.extractSnippet(entry, positiveTerms),
                });
            }
        }

        this.sortResults(results);
        return results;
    }

    /**
     * Return all indexed files, sorted.
     */
    private allFilesSorted(): SearchResult[] {
        const results: SearchResult[] = [];
        for (const entry of this.index.values()) {
            results.push({
                file: entry.file,
                filename: entry.rawFilename,
                matchInFilename: false,
            });
        }
        this.sortResults(results);
        return results;
    }

    /**
     * Sort results based on the current sort order setting.
     */
    private sortResults(results: SearchResult[]): void {
        const order = this.settings.sortOrder;
        switch (order) {
            case 'a-z':
                results.sort((a, b) => a.filename.localeCompare(b.filename));
                break;
            case 'z-a':
                results.sort((a, b) => b.filename.localeCompare(a.filename));
                break;
            case 'created-new':
                results.sort((a, b) => b.file.stat.ctime - a.file.stat.ctime);
                break;
            case 'created-old':
                results.sort((a, b) => a.file.stat.ctime - b.file.stat.ctime);
                break;
            case 'modified-new':
                results.sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
                break;
            case 'modified-old':
                results.sort((a, b) => a.file.stat.mtime - b.file.stat.mtime);
                break;
            default:
                results.sort((a, b) => a.filename.localeCompare(b.filename));
        }
    }

    /**
     * Evaluate an AST node against an index entry.
     * Searches both filename and content (substring, case-insensitive).
     */
    evaluate(node: SearchNode, entry: IndexEntry): boolean {
        switch (node.type) {
            case 'WORD': {
                const term = foldCase(node.value);
                return entry.filename.includes(term) || entry.content.includes(term);
            }
            case 'PHRASE': {
                const phrase = foldCase(node.value);
                return entry.filename.includes(phrase) || entry.content.includes(phrase);
            }
            case 'AND':
                return this.evaluate(node.left, entry) && this.evaluate(node.right, entry);
            case 'OR':
                return this.evaluate(node.left, entry) || this.evaluate(node.right, entry);
            case 'NOT':
                return !this.evaluate(node.operand, entry);
        }
    }

    // ─── Snippet Production ──────────────────────────────────────────

    /**
     * Build an original-case snippet around the first term match, split into
     * pieces so views can mark hits. Matching runs on the case-folded index,
     * whose offsets line up with the original text.
     */
    private extractSnippet(entry: IndexEntry, terms: string[]): SnippetPiece[] | undefined {
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
        const windowSize = 100;
        const half = Math.floor(windowSize / 2);
        const start = Math.max(0, firstPos - half);
        const end = Math.min(content.length, firstPos + matchLen + half);
        const inner = entry.rawContent.substring(start, end).trim();
        if (!inner) return undefined;

        const pieces = highlightPieces(inner, terms);
        if (start > 0) pieces.unshift({ text: '... ', hit: false });
        if (end < content.length) pieces.push({ text: '...', hit: false });
        return pieces;
    }
}
