/**
 * Omnibar sidebar view — the core UI for The Archive Search.
 *
 * - Persistent sidebar pane (ItemView)
 * - Text input with real-time filtering
 * - Arrow-key browsing opens selected file in editor
 * - Unlimited navigation stack with back/forward
 */

import { ItemView, MarkdownView, WorkspaceLeaf, TFile, Menu, setIcon, normalizePath, Notice } from 'obsidian';
import type TheArchiveSearchPlugin from '../main';
import { SearchResult } from './search-engine';

import { parseQuery } from './parser';
import { extractSearchTerms, highlightInEditor, clearHighlightsInEditor } from './editor-highlight';
import { EditorView } from '@codemirror/view';

export const VIEW_TYPE_OMNIBAR = 'the-archive-omnibar';

interface NavEntry {
    query: string;
    selectedIndex: number;
}

export class OmnibarView extends ItemView {
    plugin: TheArchiveSearchPlugin;

    private inputEl: HTMLInputElement;
    private resultListEl: HTMLElement;

    private navBackEl: HTMLElement;
    private navForwardEl: HTMLElement;

    private results: SearchResult[] = [];
    private selectedIndex = 0;

    // Pinned "Current note" at index 0
    private currentNoteFile: TFile | null = null;

    /** Number of pinned rows before search results (0 or 1). */
    private get offset(): number {
        return this.currentNoteFile ? 1 : 0;
    }

    // Multi-select state (independent from arrow-key browsing)
    private selectedIndices: Set<number> = new Set();
    private lastClickedIndex = -1;

    /** When the current query exactly matches a filename, lock highlighting to the full filename only. */
    private exactFilenameTerm: string | null = null;

    // Navigation stack
    private navStack: NavEntry[] = [];
    private navPos = -1; // current position in the stack
    private navigating = false; // flag to prevent pushing while navigating

    constructor(leaf: WorkspaceLeaf, plugin: TheArchiveSearchPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_OMNIBAR;
    }

    getDisplayText(): string {
        return 'The Archive Search';
    }

    getIcon(): string {
        return 'search';
    }

    async onOpen(): Promise<void> {
        const container = this.contentEl;
        container.empty();
        container.addClass('the-archive-omnibar');

        // ── Header bar (input + nav buttons) ──
        const headerEl = container.createDiv({ cls: 'omnibar-header' });

        this.inputEl = headerEl.createEl('input', {
            type: 'text',
            placeholder: 'Search...',
            cls: 'omnibar-input',
        });

        const navContainer = headerEl.createDiv({ cls: 'omnibar-nav' });
        this.navBackEl = navContainer.createDiv({ cls: 'omnibar-nav-btn' });
        setIcon(this.navBackEl, 'arrow-left');
        this.navBackEl.setAttribute('aria-label', 'Back');
        this.navBackEl.addEventListener('click', () => this.navigateBack());

        this.navForwardEl = navContainer.createDiv({ cls: 'omnibar-nav-btn' });
        setIcon(this.navForwardEl, 'arrow-right');
        this.navForwardEl.setAttribute('aria-label', 'Forward');
        this.navForwardEl.addEventListener('click', () => this.navigateForward());

        // ── Result list ──
        this.resultListEl = container.createDiv({ cls: 'omnibar-results' });



        // ── Event listeners ──
        this.inputEl.addEventListener('input', () => {
            this.executeSearch();
        });

        this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.moveSelection(1, e.shiftKey);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.moveSelection(-1, e.shiftKey);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                this.handleEnter();
            } else if (e.key === 'Escape') {
                if (this.selectedIndices.size > 0) {
                    e.preventDefault();
                    this.clearMultiSelect();
                }
            }
        });

        // Initial search (show all files)
        this.executeSearch();
        this.updateNavButtons();
    }

    async onClose(): Promise<void> {
        // Clear any highlights in the editor
        const editorView = this.getEditorViewFromLeaf();
        if (editorView) {
            clearHighlightsInEditor(editorView);
        }
    }

    /**
     * Focus the input field. Called by the hotkey command.
     * Captures the currently-open file as the pinned "Current note".
     */
    focusInput(): void {
        this.currentNoteFile = this.getCurrentFile();
        this.inputEl?.focus();
        this.inputEl?.select();
    }

    /**
     * Set the search query programmatically (used by wiki-link handler).
     * Captures the currently-open file as the pinned "Current note".
     */
    setQuery(query: string): void {
        this.currentNoteFile = this.getCurrentFile();
        if (this.inputEl) {
            this.inputEl.value = query;
            this.executeSearch();
        }
    }

    /**
     * Get the TFile for the note currently open in the main editor.
     */
    private getCurrentFile(): TFile | null {
        const leaf = this.app.workspace.getMostRecentLeaf();
        if (leaf?.view instanceof MarkdownView) {
            return leaf.view.file;
        }
        return null;
    }

    /**
     * Detect whether the current (bare) query exactly matches a filename in results,
     * and if so, capture the original-case filename for exclusive highlighting.
     */
    private detectExactFilenameTerm(): void {
        this.exactFilenameTerm = null;
        const query = this.inputEl.value;
        const queryTrimmed = query.trim();
        if (!queryTrimmed || query.startsWith('"')) {
            return;
        }
        const queryLower = queryTrimmed.toLowerCase();
        const exactIdx = this.results.findIndex((r) => {
            const nameNoExt = r.filename.replace(/\.md$/i, '').toLowerCase();
            return nameNoExt === queryLower;
        });
        if (exactIdx !== -1) {
            this.exactFilenameTerm = this.results[exactIdx].filename;
        }
    }

    /**
     * Execute a search based on the current input value.
     */
    private executeSearch(): void {
        const query = this.inputEl.value;
        this.results = this.plugin.searchEngine.search(query);
        this.selectedIndex = 0; // Points to current-note row (no file switch)
        this.selectedIndices.clear(); // New search clears multi-select

        // Detect exact filename match from the bare query results (for highlighting mode)
        this.detectExactFilenameTerm();

        // If the query exactly matches a filename, re-search with the query
        // wrapped in quotes for exact phrase matching (narrows results)
        const queryTrimmed = query.trim();
        if (queryTrimmed && !query.startsWith('"') && this.exactFilenameTerm) {
            this.results = this.plugin.searchEngine.search(`"${queryTrimmed}"`);
            // Re-find the exact match index in the new (phrase) results
            const queryLower = queryTrimmed.toLowerCase();
            const reIdx = this.results.findIndex((r) => {
                const nameNoExt = r.filename.replace(/\.md$/i, '').toLowerCase();
                return nameNoExt === queryLower;
            });
            if (reIdx !== -1) {
                this.selectedIndex = reIdx + this.offset;
            }
            // exactFilenameTerm stays set for the lifetime of this query
        }

        this.renderResults();

        // Open the selected file in the editor
        // (index 0 = current note = no-op; exact match = jumps to that file)
        this.openSelectedInEditor();

        // Scroll selected into view (for exact-match jumps)
        const selectedEl = this.resultListEl.querySelector('.is-selected');
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' });
        }

        // Push to nav stack (unless we're navigating back/forward)
        if (!this.navigating && queryTrimmed) {
            this.pushNavState();
        }
    }

    /**
     * Render the result list.
     */
    private renderResults(): void {
        this.resultListEl.empty();

        const query = this.inputEl.value.trim();
        const off = this.offset;

        // ── Pinned "Current note" row (index 0) ──
        if (this.currentNoteFile) {
            const isActive = this.selectedIndex === 0;

            let cls = 'omnibar-result-item omnibar-current-note-item';
            if (isActive) cls += ' is-selected';

            const currentEl = this.resultListEl.createDiv({ cls });

            const iconEl = currentEl.createSpan({ cls: 'omnibar-current-note-icon' });
            setIcon(iconEl, 'file-text');

            currentEl.createSpan({
                cls: 'omnibar-result-title',
                text: `Current note: ${this.currentNoteFile.basename}`,
            });

            // Folder path on the right
            const folderPath = this.currentNoteFile.parent?.path || '';
            if (folderPath) {
                currentEl.createSpan({
                    cls: 'omnibar-result-path',
                    text: folderPath,
                });
            }

            currentEl.addEventListener('click', () => {
                this.selectedIndices.clear();
                this.selectedIndex = 0;
                this.renderResults();
                this.openSelectedInEditor();
            });
        }

        // ── Search results (indices off … off + results.length - 1) ──
        for (let i = 0; i < this.results.length; i++) {
            const globalIdx = i + off;
            const result = this.results[i];
            const isActive = globalIdx === this.selectedIndex;
            const isMulti = this.selectedIndices.has(globalIdx);

            let cls = 'omnibar-result-item';
            if (isActive) cls += ' is-selected';
            if (isMulti) cls += ' is-multi-selected';

            const itemEl = this.resultListEl.createDiv({ cls });

            const titleEl = itemEl.createSpan({
                cls: 'omnibar-result-title',
            });

            titleEl.textContent = result.filename;

            if (result.matchInFilename) {
                titleEl.addClass('is-filename-match');
            }

            // Folder path on the right
            const folderPath = result.file.parent?.path || '';
            if (folderPath) {
                itemEl.createSpan({
                    cls: 'omnibar-result-path',
                    text: folderPath,
                });
            }

            // Click handler: plain / ctrl / shift
            itemEl.addEventListener('click', (e: MouseEvent) => {
                if (e.ctrlKey || e.metaKey) {
                    // Ctrl+click: toggle this item in multi-select
                    if (this.selectedIndices.has(globalIdx)) {
                        this.selectedIndices.delete(globalIdx);
                    } else {
                        this.selectedIndices.add(globalIdx);
                    }
                    this.lastClickedIndex = globalIdx;
                    this.renderResults();
                } else if (e.shiftKey) {
                    // Shift+click: range select from lastClickedIndex (or selectedIndex) to i
                    const anchor = this.lastClickedIndex >= 0 ? this.lastClickedIndex : this.selectedIndex;
                    const start = Math.min(anchor, globalIdx);
                    const end = Math.max(anchor, globalIdx);
                    for (let j = start; j <= end; j++) {
                        this.selectedIndices.add(j);
                    }
                    this.renderResults();
                } else {
                    // Plain click: clear multi-select, select and open
                    this.selectedIndices.clear();
                    this.lastClickedIndex = globalIdx;
                    this.selectedIndex = globalIdx;
                    this.renderResults();
                    this.openSelectedInEditor();
                    this.pushNavState();
                }
            });

            // Right-click: native Obsidian context menu
            itemEl.addEventListener('contextmenu', (e: MouseEvent) => {
                e.preventDefault();

                // If right-clicking a non-selected item, select just that one
                if (!this.selectedIndices.has(globalIdx) && globalIdx !== this.selectedIndex) {
                    this.selectedIndices.clear();
                    this.selectedIndices.add(globalIdx);
                    this.renderResults();
                }

                const files = this.getSelectedFiles();
                const menu = new Menu();

                if (files.length > 1) {
                    this.app.workspace.trigger('files-menu', menu, files, 'the-archive-search');
                } else if (files.length === 1) {
                    this.app.workspace.trigger('file-menu', menu, files[0], 'the-archive-search');
                }

                menu.showAtMouseEvent(e);
            });
        }

        // ── "Create new note" row (always last when query is non-empty) ──
        if (query) {
            const createIndex = off + this.results.length;
            const isActive = this.selectedIndex === createIndex;

            let cls = 'omnibar-result-item omnibar-create-item';
            if (isActive) cls += ' is-selected';

            const createEl = this.resultListEl.createDiv({ cls });

            const iconEl = createEl.createSpan({ cls: 'omnibar-create-icon' });
            setIcon(iconEl, 'plus');

            createEl.createSpan({
                cls: 'omnibar-create-text',
                text: `Create new note: "${query}"`,
            });

            createEl.addEventListener('click', () => {
                this.createNote();
            });
        }
    }

    /**
     * Move the selection highlight up or down.
     * If shift is held, also add to multi-select.
     */
    private moveSelection(delta: number, shift = false): void {
        // Upper bound accounts for offset (current note row) and create row
        const query = this.inputEl.value.trim();
        const off = this.offset;
        const maxIndex = query
            ? off + this.results.length   // create row is last
            : off + this.results.length - 1;
        if (maxIndex < 0) return;

        if (shift) {
            // Shift+Arrow: add current position to multi-select, then move
            this.selectedIndices.add(this.selectedIndex);
        } else {
            // Plain arrow: clear multi-select
            this.selectedIndices.clear();
        }

        this.selectedIndex = Math.max(
            0,
            Math.min(maxIndex, this.selectedIndex + delta)
        );

        if (shift) {
            this.selectedIndices.add(this.selectedIndex);
        }

        this.renderResults();

        if (!shift) {
            this.openSelectedInEditor();
        }

        // Scroll selected into view
        const selectedEl = this.resultListEl.querySelector('.is-selected');
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' });
        }
    }

    /**
     * Clear the multi-select state and re-render.
     */
    private clearMultiSelect(): void {
        this.selectedIndices.clear();
        this.lastClickedIndex = -1;
        this.renderResults();
    }

    /**
     * Get the TFile[] for all selected items.
     * Returns multi-selected items if any, otherwise just the active item.
     */
    private getSelectedFiles(): TFile[] {
        const off = this.offset;
        if (this.selectedIndices.size > 0) {
            return Array.from(this.selectedIndices)
                .filter((idx) => idx >= off && idx < off + this.results.length)
                .map((idx) => this.results[idx - off].file);
        }
        // Fallback to just the active (arrow-key) selection
        if (this.selectedIndex >= off && this.selectedIndex < off + this.results.length) {
            return [this.results[this.selectedIndex - off].file];
        }
        // Current note fallback
        if (this.selectedIndex === 0 && this.currentNoteFile) {
            return [this.currentNoteFile];
        }
        return [];
    }

    /**
     * Open the currently selected file in the editor pane.
     */
    private async openSelectedInEditor(): Promise<void> {
        const off = this.offset;
        let fileToOpen: TFile | null = null;

        if (this.selectedIndex === 0 && this.currentNoteFile) {
            // Current note row — re-open the pinned note (usually a no-op)
            fileToOpen = this.currentNoteFile;
        } else if (this.selectedIndex >= off && this.selectedIndex < off + this.results.length) {
            // Search result row
            fileToOpen = this.results[this.selectedIndex - off].file;
        }

        if (!fileToOpen) return;

        const leaf = this.app.workspace.getMostRecentLeaf();
        if (leaf) {
            await leaf.openFile(fileToOpen);

            // Highlight search terms in the editor
            const query = this.inputEl.value.trim();
            if (query && this.plugin.settings.highlightMatches) {
                let terms: string[];
                if (this.exactFilenameTerm) {
                    // Exact filename query (e.g. triggered from inside [[link]]): always highlight only the full filename
                    terms = [this.exactFilenameTerm];
                } else {
                    const off = this.offset;
                    const selectedFilename: string | null = (
                        this.selectedIndex >= off && this.selectedIndex < off + this.results.length
                    ) ? this.results[this.selectedIndex - off].filename : null;

                    const queryLower = query.toLowerCase();
                    const isExactMatch = selectedFilename
                        && selectedFilename.replace(/\.md$/i, '').toLowerCase() === queryLower;

                    terms = isExactMatch
                        ? [selectedFilename]
                        : extractSearchTerms(parseQuery(query));
                }

                if (terms.length > 0) {
                    setTimeout(() => {
                        const editorView = this.getEditorViewFromLeaf(leaf);
                        if (editorView) {
                            highlightInEditor(editorView, terms);
                        }
                    }, 100);
                }
            }
        }
    }

    /**
     * Get the CodeMirror EditorView from a specific leaf.
     * Falls back to getMostRecentLeaf if no leaf is provided.
     *
     * Uses MarkdownView (not ItemView) to avoid returning the
     * Omnibar itself when the sidebar has focus.
     */
    private getEditorViewFromLeaf(leaf?: WorkspaceLeaf | null): EditorView | null {
        const targetLeaf = leaf ?? this.app.workspace.getMostRecentLeaf();
        if (targetLeaf?.view instanceof MarkdownView) {
            const editor = (targetLeaf.view as any)?.editor;
            if (editor?.cm instanceof EditorView) {
                return editor.cm;
            }
        }
        return null;
    }

    /**
     * Handle Enter key: open the selected result, clear highlights,
     * and move cursor to the first match in the file.
     */
    private async handleEnter(): Promise<void> {
        const query = this.inputEl.value.trim();
        const off = this.offset;

        // If the create-note row is selected, create the note
        if (query && this.selectedIndex === off + this.results.length) {
            await this.createNote();
            return;
        }

        // Open the selected file (current note or search result)
        await this.openSelectedInEditor();

        // Small delay to let the file fully load
        setTimeout(() => {
            const leaf = this.app.workspace.getMostRecentLeaf();
            if (leaf?.view instanceof MarkdownView) {
                const editor = leaf.view.editor;

                // Clear highlights
                const editorView = this.getEditorViewFromLeaf(leaf);
                if (editorView) {
                    clearHighlightsInEditor(editorView);
                }

                // Move cursor to first match
                if (query) {
                    let jumpTerms: string[];
                    if (this.exactFilenameTerm) {
                        jumpTerms = [this.exactFilenameTerm];
                    } else {
                        const ast = parseQuery(query);
                        jumpTerms = extractSearchTerms(ast);
                    }
                    if (jumpTerms.length > 0) {
                        const docText = editor.getValue().toLowerCase();
                        let firstPos = Infinity;
                        for (const term of jumpTerms) {
                            const pos = docText.indexOf(term.toLowerCase());
                            if (pos !== -1 && pos < firstPos) {
                                firstPos = pos;
                            }
                        }
                        if (firstPos !== Infinity) {
                            const editorPos = editor.offsetToPos(firstPos);
                            editor.setCursor(editorPos);
                        }
                    }
                }

                // Focus the editor
                this.app.workspace.setActiveLeaf(leaf, { focus: true });
                editor.focus();
            }
        }, 120);
    }

    /**
     * Create a new note using the current search query as the filename.
     * Respects the newNoteLocation setting for file placement.
     */
    private async createNote(): Promise<void> {
        const title = this.inputEl.value.trim();
        if (!title) return;

        // Build the file path based on settings
        const settings = this.plugin.settings;
        let folderPath = '';
        if (settings.newNoteLocation === 'custom' && settings.newNoteFolder) {
            folderPath = settings.newNoteFolder;
        }

        const filePath = normalizePath(
            folderPath ? `${folderPath}/${title}.md` : `${title}.md`
        );

        // Duplicate guard: if the file already exists, just open it
        const existing = this.app.vault.getFileByPath(filePath);
        if (existing) {
            const leaf = this.app.workspace.getMostRecentLeaf();
            if (leaf) {
                await leaf.openFile(existing);
                this.app.workspace.setActiveLeaf(leaf, { focus: true });
            }
            return;
        }

        try {
            // Ensure the folder exists
            if (folderPath) {
                const folderExists = this.app.vault.getFolderByPath(normalizePath(folderPath));
                if (!folderExists) {
                    await this.app.vault.createFolder(normalizePath(folderPath));
                }
            }

            const newFile = await this.app.vault.create(filePath, '');
            const leaf = this.app.workspace.getMostRecentLeaf();
            if (leaf) {
                await leaf.openFile(newFile);
                this.app.workspace.setActiveLeaf(leaf, { focus: true });

                // Focus the editor
                setTimeout(() => {
                    if (leaf.view instanceof MarkdownView) {
                        leaf.view.editor.focus();
                    }
                }, 50);
            }
        } catch (err) {
            new Notice(`Failed to create note: ${err}`);
        }
    }

    // ── Navigation Stack ──

    private pushNavState(): void {
        const entry: NavEntry = {
            query: this.inputEl.value,
            selectedIndex: this.selectedIndex,
        };

        // Truncate forward history if we're not at the end
        if (this.navPos < this.navStack.length - 1) {
            this.navStack = this.navStack.slice(0, this.navPos + 1);
        }

        this.navStack.push(entry);
        this.navPos = this.navStack.length - 1;
        this.updateNavButtons();
    }

    private navigateBack(): void {
        if (this.navPos <= 0) return;
        this.navPos--;
        this.restoreNavState();
    }

    private navigateForward(): void {
        if (this.navPos >= this.navStack.length - 1) return;
        this.navPos++;
        this.restoreNavState();
    }

    private restoreNavState(): void {
        const entry = this.navStack[this.navPos];
        if (!entry) return;

        this.navigating = true;
        this.inputEl.value = entry.query;
        this.results = this.plugin.searchEngine.search(entry.query);
        this.detectExactFilenameTerm();

        // If this was an exact filename query, re-apply phrase search for consistent result list
        // (selectedIndex was originally captured against the promoted list)
        if (this.exactFilenameTerm) {
            const qTrim = entry.query.trim();
            if (qTrim) {
                this.results = this.plugin.searchEngine.search(`"${qTrim}"`);
            }
        }

        const maxIdx = this.offset + this.results.length - 1;
        this.selectedIndex = Math.min(entry.selectedIndex, Math.max(0, maxIdx));
        this.renderResults();
        this.openSelectedInEditor();
        this.navigating = false;
        this.updateNavButtons();
    }

    private updateNavButtons(): void {
        if (this.navBackEl) {
            this.navBackEl.toggleClass('is-disabled', this.navPos <= 0);
        }
        if (this.navForwardEl) {
            this.navForwardEl.toggleClass('is-disabled', this.navPos >= this.navStack.length - 1);
        }
    }
}
