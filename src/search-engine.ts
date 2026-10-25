/**
 * Search engine that indexes the vault and evaluates parsed boolean queries.
 *
 * - Builds an in-memory index of filename + content (lowercased for case-insensitive search)
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
    filename: string;      // lowercased basename (no extension)
    content: string;       // lowercased full text content
    rawContent: string;    // original-case full text content (for snippets)
    rawFilename: string;   // original-case basename (no extension)
}

// ─── Snippet Piece ───────────────────────────────────────────────

/** A run of snippet text in original case; `hit` marks a search-term match. */
export interface SnippetPiece {
    text: string;
    hit: boolean;
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
            },
            onRename: async (file: TAbstractFile, oldPath: string) => {
                this.index.delete(oldPath);
                if (file instanceof TFile && file.extension === 'md') {
                    if (!this.isExcluded(file)) {
                        await this.indexFile(file);
                    }
                }
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
                filename: basename.toLowerCase(),
                content: content.toLowerCase(),
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
        const queryLower = query.toLowerCase();
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
                const term = node.value.toLowerCase();
                return entry.filename.includes(term) || entry.content.includes(term);
            }
            case 'PHRASE': {
                const phrase = node.value.toLowerCase();
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
     * pieces so views can mark hits. Matching runs on the lowercased index.
     */
    private extractSnippet(entry: IndexEntry, terms: string[]): SnippetPiece[] | undefined {
        if (terms.length === 0) return undefined;
        const content = entry.content;
        const lowerTerms = terms.map(t => t.toLowerCase()).filter(t => t);
        let firstPos = -1;
        let matchLen = 0;
        for (const t of lowerTerms) {
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
        // Lowercasing can change string length for a few characters; only then
        // do index positions stop lining up with the original text.
        const aligned = entry.rawContent.length === content.length;
        const source = aligned ? entry.rawContent : content;
        const inner = source.substring(start, end).trim();

        const pieces = this.splitHits(inner, lowerTerms);
        if (start > 0) pieces.unshift({ text: inner ? '... ' : '...', hit: false });
        if (end < content.length) pieces.push({ text: '...', hit: false });
        return pieces.length > 0 ? pieces : undefined;
    }

    /**
     * Split text into pieces, flagging case-insensitive matches of any term.
     * Overlapping matches become adjacent hit pieces; at equal starts the longest wins.
     */
    private splitHits(text: string, lowerTerms: string[]): SnippetPiece[] {
        const lower = text.toLowerCase();
        const ranges: Array<[number, number]> = [];
        for (const t of lowerTerms) {
            let from = 0;
            for (let pos = lower.indexOf(t, from); pos !== -1; pos = lower.indexOf(t, from)) {
                ranges.push([pos, pos + t.length]);
                from = pos + t.length;
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
        if (cursor < text.length) pieces.push({ text: text.substring(cursor), hit: false });
        return pieces;
    }
}
