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
import type { SortOrder, ArchiveSearchSettings } from './settings';

// ─── Index Entry ─────────────────────────────────────────────────

export interface IndexEntry {
    file: TFile;
    filename: string;      // lowercased basename (no extension)
    content: string;       // lowercased full text content
    rawFilename: string;   // original-case basename (no extension)
}

// ─── Search Result ───────────────────────────────────────────────

export interface SearchResult {
    file: TFile;
    filename: string;         // original-case basename
    matchInFilename: boolean; // true if any search term matched in the filename
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

        for (const entry of this.index.values()) {
            if (this.evaluate(ast, entry)) {
                results.push({
                    file: entry.file,
                    filename: entry.rawFilename,
                    matchInFilename: entry.filename.includes(queryLower),
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
}
