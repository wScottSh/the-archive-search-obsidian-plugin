/**
 * Omnibar sidebar view — the core UI for The Archive Search.
 *
 * - Persistent sidebar pane (ItemView)
 * - Text input with real-time filtering
 * - Arrow-key browsing opens selected file in editor
 * - Unlimited navigation stack with back/forward
 */

import { ItemView, MarkdownView, WorkspaceLeaf, TFile, Menu, setIcon } from 'obsidian';
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

    // Multi-select state (independent from arrow-key browsing)
    private selectedIndices: Set<number> = new Set();
    private lastClickedIndex = -1;

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
     */
    focusInput(): void {
        this.inputEl?.focus();
        this.inputEl?.select();
    }

    /**
     * Set the search query programmatically (used by wiki-link handler).
     */
    setQuery(query: string): void {
        if (this.inputEl) {
            this.inputEl.value = query;
            this.executeSearch();
        }
    }

    /**
     * Execute a search based on the current input value.
     */
    private executeSearch(): void {
        const query = this.inputEl.value;
        this.results = this.plugin.searchEngine.search(query);
        this.selectedIndex = 0;
        this.selectedIndices.clear(); // New search clears multi-select

        // If the query exactly matches a filename, auto-select that result
        if (query.trim()) {
            const queryLower = query.trim().toLowerCase();
            const exactIdx = this.results.findIndex((r) => {
                // Match against filename without extension
                const nameNoExt = r.filename.replace(/\.md$/i, '').toLowerCase();
                return nameNoExt === queryLower;
            });
            if (exactIdx !== -1) {
                this.selectedIndex = exactIdx;
            }
        }

        this.renderResults();

        // Open the selected result in the editor if there are results
        if (this.results.length > 0) {
            this.openSelectedInEditor();
        }

        // Scroll selected into view (for exact-match jumps)
        const selectedEl = this.resultListEl.querySelector('.is-selected');
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' });
        }

        // Push to nav stack (unless we're navigating back/forward)
        if (!this.navigating && query.trim()) {
            this.pushNavState();
        }
    }

    /**
     * Render the result list.
     */
    private renderResults(): void {
        this.resultListEl.empty();

        const query = this.inputEl.value.trim();

        if (this.results.length === 0) {
            return;
        }

        for (let i = 0; i < this.results.length; i++) {
            const result = this.results[i];
            const isActive = i === this.selectedIndex;
            const isMulti = this.selectedIndices.has(i);

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
                    if (this.selectedIndices.has(i)) {
                        this.selectedIndices.delete(i);
                    } else {
                        this.selectedIndices.add(i);
                    }
                    this.lastClickedIndex = i;
                    this.renderResults();
                } else if (e.shiftKey) {
                    // Shift+click: range select from lastClickedIndex (or selectedIndex) to i
                    const anchor = this.lastClickedIndex >= 0 ? this.lastClickedIndex : this.selectedIndex;
                    const start = Math.min(anchor, i);
                    const end = Math.max(anchor, i);
                    for (let j = start; j <= end; j++) {
                        this.selectedIndices.add(j);
                    }
                    this.renderResults();
                } else {
                    // Plain click: clear multi-select, select and open
                    this.selectedIndices.clear();
                    this.lastClickedIndex = i;
                    this.selectedIndex = i;
                    this.renderResults();
                    this.openSelectedInEditor();
                    this.pushNavState();
                }
            });

            // Right-click: native Obsidian context menu
            itemEl.addEventListener('contextmenu', (e: MouseEvent) => {
                e.preventDefault();

                // If right-clicking a non-selected item, select just that one
                if (!this.selectedIndices.has(i) && i !== this.selectedIndex) {
                    this.selectedIndices.clear();
                    this.selectedIndices.add(i);
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
    }

    /**
     * Move the selection highlight up or down.
     * If shift is held, also add to multi-select.
     */
    private moveSelection(delta: number, shift = false): void {
        if (this.results.length === 0) return;

        if (shift) {
            // Shift+Arrow: add current position to multi-select, then move
            this.selectedIndices.add(this.selectedIndex);
        } else {
            // Plain arrow: clear multi-select
            this.selectedIndices.clear();
        }

        this.selectedIndex = Math.max(
            0,
            Math.min(this.results.length - 1, this.selectedIndex + delta)
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
        if (this.selectedIndices.size > 0) {
            return Array.from(this.selectedIndices)
                .filter((idx) => idx >= 0 && idx < this.results.length)
                .map((idx) => this.results[idx].file);
        }
        // Fallback to just the active (arrow-key) selection
        if (this.selectedIndex >= 0 && this.selectedIndex < this.results.length) {
            return [this.results[this.selectedIndex].file];
        }
        return [];
    }

    /**
     * Open the currently selected file in the editor pane.
     */
    private async openSelectedInEditor(): Promise<void> {
        if (this.selectedIndex < 0 || this.selectedIndex >= this.results.length) return;

        const result = this.results[this.selectedIndex];
        const leaf = this.app.workspace.getMostRecentLeaf();
        if (leaf && result.file) {
            await leaf.openFile(result.file);

            // Highlight search terms in the editor
            const query = this.inputEl.value.trim();
            if (query && this.plugin.settings.highlightMatches) {
                const ast = parseQuery(query);
                const terms = extractSearchTerms(ast);
                if (terms.length > 0) {
                    // Delay to let the file content load, then highlight
                    // We re-acquire the EditorView from the specific leaf
                    // we opened the file into (not the active view, which
                    // is the Omnibar sidebar when using arrow keys)
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
        if (this.results.length > 0) {
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
                    const query = this.inputEl.value.trim();
                    if (query) {
                        const ast = parseQuery(query);
                        const terms = extractSearchTerms(ast);
                        if (terms.length > 0) {
                            const docText = editor.getValue().toLowerCase();
                            let firstPos = Infinity;
                            for (const term of terms) {
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
        this.selectedIndex = Math.min(entry.selectedIndex, this.results.length - 1);
        this.renderResults();
        if (this.results.length > 0) {
            this.openSelectedInEditor();
        }
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
