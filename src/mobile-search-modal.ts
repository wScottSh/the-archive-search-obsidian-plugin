/**
 * Mobile-optimized full-screen search modal.
 *
 * On mobile devices, this replaces the sidebar Omnibar with a
 * full-screen modal:
 * - Search input at top with real-time filtering
 * - Scrollable result list (tap to open)
 * - Back/forward navigation stack
 * - Dismiss via ✕ button
 *
 * Reuses SearchEngine and parseQuery — no duplicated logic.
 */

import { App, Modal, Platform, setIcon, normalizePath, Notice, MarkdownView, WorkspaceLeaf } from 'obsidian';
import type TheArchiveSearchPlugin from '../main';
import { SearchResult } from './search-engine';

import { parseQuery } from './parser';
import { extractSearchTerms, highlightInEditor } from './editor-highlight';
import { EditorView } from '@codemirror/view';

interface NavEntry {
    query: string;
    selectedIndex: number;
}

export class MobileSearchModal extends Modal {
    private plugin: TheArchiveSearchPlugin;
    private inputEl: HTMLInputElement;
    private resultListEl: HTMLElement;
    private navBackEl: HTMLElement;
    private navForwardEl: HTMLElement;

    private results: SearchResult[] = [];

    // Navigation stack
    private navStack: NavEntry[] = [];
    private navPos = -1;
    private navigating = false;

    private initialQuery: string | undefined;

    constructor(app: App, plugin: TheArchiveSearchPlugin, query?: string) {
        super(app);
        this.plugin = plugin;
        this.initialQuery = query;
    }

    onOpen(): void {
        const { contentEl, modalEl } = this;

        // Make the modal full-screen on mobile
        modalEl.addClass('mobile-search-modal');

        // Remove default padding from the modal content area
        contentEl.addClass('mobile-search-content');

        // ── Header bar ──
        const headerEl = contentEl.createDiv({ cls: 'mobile-search-header' });

        // Close button
        const closeBtn = headerEl.createDiv({ cls: 'mobile-search-close' });
        setIcon(closeBtn, 'x');
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.addEventListener('click', () => this.close());

        // Search input
        this.inputEl = headerEl.createEl('input', {
            type: 'text',
            placeholder: 'Search...',
            cls: 'mobile-search-input',
        });

        // Nav buttons
        const navContainer = headerEl.createDiv({ cls: 'mobile-search-nav' });
        this.navBackEl = navContainer.createDiv({ cls: 'mobile-search-nav-btn' });
        setIcon(this.navBackEl, 'arrow-left');
        this.navBackEl.setAttribute('aria-label', 'Back');
        this.navBackEl.addEventListener('click', () => this.navigateBack());

        this.navForwardEl = navContainer.createDiv({ cls: 'mobile-search-nav-btn' });
        setIcon(this.navForwardEl, 'arrow-right');
        this.navForwardEl.setAttribute('aria-label', 'Forward');
        this.navForwardEl.addEventListener('click', () => this.navigateForward());

        // ── Result list ──
        this.resultListEl = contentEl.createDiv({ cls: 'mobile-search-results' });

        // ── Event listeners ──
        this.inputEl.addEventListener('input', () => {
            this.executeSearch();
        });

        // Set initial query if provided (from wiki-link or hashtag)
        if (this.initialQuery) {
            this.inputEl.value = this.initialQuery;
        }

        // Run initial search and update nav
        this.executeSearch();
        this.updateNavButtons();

        // Focus the input after a short delay (let the modal render)
        setTimeout(() => this.inputEl.focus(), 50);
    }

    onClose(): void {
        this.contentEl.empty();
    }

    // ── Search ──

    private executeSearch(): void {
        const query = this.inputEl.value;
        this.results = this.plugin.searchEngine.search(query);
        this.renderResults();

        // Push to nav stack
        if (!this.navigating && query.trim()) {
            this.pushNavState();
        }
    }

    // ── Render ──

    private renderResults(): void {
        this.resultListEl.empty();

        const query = this.inputEl.value.trim();

        if (this.results.length === 0 && !query) {
            return;
        }

        if (this.results.length === 0 && query) {
            this.resultListEl.createDiv({
                cls: 'mobile-search-empty',
                text: 'No results found',
            });
        }

        for (let i = 0; i < this.results.length; i++) {
            const result = this.results[i];

            const itemEl = this.resultListEl.createDiv({
                cls: 'mobile-search-result-item',
            });

            const titleEl = itemEl.createSpan({
                cls: 'omnibar-result-title',
            });
            titleEl.textContent = result.filename;

            if (result.matchInFilename) {
                titleEl.addClass('is-filename-match');
            }

            // Folder path
            const folderPath = result.file.parent?.path || '';
            if (folderPath) {
                itemEl.createSpan({
                    cls: 'omnibar-result-path',
                    text: folderPath,
                });
            }

            if (this.plugin.settings.showMobilePreviews && result.snippet) {
                itemEl.createDiv({
                    cls: 'mobile-search-result-snippet',
                    text: result.snippet,
                });
            }

            // Tap to open
            itemEl.addEventListener('click', () => {
                this.openResult(result);
            });
        }

        // ── "Create new note" row (always last when query is non-empty) ──
        if (query) {
            const createEl = this.resultListEl.createDiv({
                cls: 'mobile-search-result-item mobile-search-create-item',
            });

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

    // ── Open Result ──

    private async openResult(result: SearchResult): Promise<void> {
        const query = this.inputEl.value.trim();
        this.close();

        const leaf = this.app.workspace.getMostRecentLeaf();
        if (leaf && result.file) {
            await leaf.openFile(result.file);
            setTimeout(() => {
                if (leaf?.view instanceof MarkdownView) {
                    const editor = leaf.view.editor;
                    const editorView = this.getEditorViewFromLeaf(leaf);
                    if (query) {
                        const ast = parseQuery(query);
                        const terms = extractSearchTerms(ast);
                        if (terms.length > 0) {
                            if (this.plugin.settings.highlightMatches && editorView) {
                                highlightInEditor(editorView, terms);
                            }
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
            selectedIndex: 0,
        };

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
        this.renderResults();
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
     * Create a new note using the current search query as the filename.
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
            this.close();
            const leaf = this.app.workspace.getMostRecentLeaf();
            if (leaf) {
                await leaf.openFile(existing);
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
            this.close();
            const leaf = this.app.workspace.getMostRecentLeaf();
            if (leaf) {
                await leaf.openFile(newFile);

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
}
