/**
 * Omnibar sidebar view — the core UI for The Archive Search.
 *
 * - Persistent sidebar pane (ItemView)
 * - Text input with real-time filtering
 * - Arrow-key browsing opens selected file in editor
 * - Enter-to-create when no match exists
 * - Unlimited navigation stack with back/forward
 */

import { ItemView, MarkdownView, WorkspaceLeaf, TFile, setIcon } from 'obsidian';
import type TheArchiveSearchPlugin from '../main';
import { SearchResult } from './search-engine';
import { createNoteFromSearch } from './note-creator';
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
    private createPromptEl: HTMLElement;
    private navBackEl: HTMLElement;
    private navForwardEl: HTMLElement;

    private results: SearchResult[] = [];
    private selectedIndex = 0;

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
            placeholder: 'Search or create...',
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

        // ── Create prompt ──
        this.createPromptEl = container.createDiv({ cls: 'omnibar-create-prompt' });
        this.createPromptEl.style.display = 'none';

        // ── Event listeners ──
        this.inputEl.addEventListener('input', () => {
            this.executeSearch();
        });

        this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.moveSelection(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.moveSelection(-1);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                this.handleEnter();
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
        this.renderResults();

        // Open the first result in the editor if there are results
        if (this.results.length > 0) {
            this.openSelectedInEditor();
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

        if (this.results.length === 0 && query) {
            this.createPromptEl.style.display = 'block';
            this.createPromptEl.empty();
            const icon = this.createPromptEl.createSpan({ cls: 'omnibar-create-icon' });
            icon.textContent = '↵';
            this.createPromptEl.createSpan({
                text: ` Create "${query}"`,
                cls: 'omnibar-create-text',
            });
            return;
        }

        this.createPromptEl.style.display = 'none';

        for (let i = 0; i < this.results.length; i++) {
            const result = this.results[i];
            const itemEl = this.resultListEl.createDiv({
                cls: `omnibar-result-item${i === this.selectedIndex ? ' is-selected' : ''}`,
            });

            const titleEl = itemEl.createSpan({
                cls: 'omnibar-result-title',
            });

            titleEl.textContent = result.filename;

            if (result.matchInFilename) {
                titleEl.addClass('is-filename-match');
            }

            // Click to select and open
            itemEl.addEventListener('click', () => {
                this.selectedIndex = i;
                this.renderResults();
                this.openSelectedInEditor();
                this.pushNavState();
            });
        }
    }

    /**
     * Move the selection highlight up or down.
     */
    private moveSelection(delta: number): void {
        if (this.results.length === 0) return;

        this.selectedIndex = Math.max(
            0,
            Math.min(this.results.length - 1, this.selectedIndex + delta)
        );
        this.renderResults();
        this.openSelectedInEditor();

        // Scroll selected into view
        const selectedEl = this.resultListEl.querySelector('.is-selected');
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' });
        }
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
     * Handle Enter key: either open the selected result or create a new note.
     */
    private async handleEnter(): Promise<void> {
        const query = this.inputEl.value.trim();
        if (!query) return;

        if (this.results.length > 0) {
            // Open the selected result
            await this.openSelectedInEditor();
        } else {
            // Create a new note
            const file = await createNoteFromSearch(
                this.app,
                query,
                this.plugin.settings
            );
            if (file) {
                const leaf = this.app.workspace.getMostRecentLeaf();
                if (leaf) {
                    await leaf.openFile(file);
                }
                // Re-execute search to show the new file
                this.executeSearch();
            }
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
