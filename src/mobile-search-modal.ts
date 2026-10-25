/**
 * Mobile-optimized full-screen search modal.
 *
 * On mobile devices, this replaces the sidebar Omnibar with a
 * full-screen modal:
 * - Scrollable result list (tap to open)
 * - Search capsule docked to the bottom edge, riding on the keyboard
 *   (back/forward, input, clear, close)
 * - Back/forward navigation stack
 *
 * Reuses SearchEngine and parseQuery — no duplicated logic.
 */

import { App, Modal, Platform, setIcon, normalizePath, Notice, MarkdownView, WorkspaceLeaf } from 'obsidian';
import type TheArchiveSearchPlugin from '../main';
import { SearchResult } from './search-engine';

import { parseQuery } from './parser';
import { extractSearchTerms, highlightInEditor } from './editor-highlight';
import { EditorView } from '@codemirror/view';
import { trackKeyboard } from './keyboard-tracker';
import { insertOperator, Operator } from './operator-insert';

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
    private clearEl: HTMLElement;
    private stopTrackingKeyboard: (() => void) | undefined;

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
        const { contentEl, modalEl, containerEl } = this;

        // Restyled full-screen surface; the keyboard tracker sizes it to the visible area
        containerEl.addClass('mobile-search-container');
        modalEl.addClass('mobile-search-modal');
        contentEl.addClass('mobile-search-content');

        // ── Result list ──
        this.resultListEl = contentEl.createDiv({ cls: 'mobile-search-results' });

        // ── Dock: capsule at the bottom edge ──
        const dockEl = contentEl.createDiv({ cls: 'mobile-search-dock' });
        this.createOperatorRow(dockEl);
        const capsuleEl = dockEl.createDiv({ cls: 'mobile-search-capsule' });

        this.navBackEl = this.createIconButton(capsuleEl, 'arrow-left', 'Back', () => this.navigateBack());
        this.navForwardEl = this.createIconButton(capsuleEl, 'arrow-right', 'Forward', () => this.navigateForward());

        // Search input
        this.inputEl = capsuleEl.createEl('input', {
            type: 'text',
            placeholder: 'Search...',
            cls: 'mobile-search-input',
        });

        this.clearEl = this.createIconButton(capsuleEl, 'x-circle', 'Clear', () => {
            this.inputEl.value = '';
            this.executeSearch();
            this.updateClearButton();
            this.inputEl.focus();
        });

        this.createIconButton(capsuleEl, 'x', 'Close', () => this.close());

        // ── Event listeners ──
        this.inputEl.addEventListener('input', () => {
            this.executeSearch();
            this.updateClearButton();
        });

        // Set initial query if provided (from wiki-link or hashtag)
        if (this.initialQuery) {
            this.inputEl.value = this.initialQuery;
        }

        // Run initial search and update nav
        this.executeSearch();
        this.updateNavButtons();
        this.updateClearButton();

        this.stopTrackingKeyboard = trackKeyboard(modalEl);

        // Must happen synchronously inside the user's tap or iOS will not raise the keyboard
        this.inputEl.focus();
    }

    /**
     * Capsule button. Pressing it must not steal focus from the input,
     * otherwise the keyboard would flicker closed.
     */
    private createIconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLElement {
        const buttonEl = parent.createEl('button', { cls: 'mobile-search-icon-btn' });
        setIcon(buttonEl, icon);
        buttonEl.setAttribute('aria-label', label);
        buttonEl.addEventListener('mousedown', (e) => e.preventDefault());
        buttonEl.addEventListener('click', onClick);
        return buttonEl;
    }

    /**
     * Operator row above the capsule; CSS shows it only while the keyboard is open.
     * Buttons never take focus, so tapping one keeps the keyboard up.
     */
    private createOperatorRow(parent: HTMLElement): void {
        const rowEl = parent.createDiv({ cls: 'mobile-search-operators' });
        const operators: [Operator, string, string][] = [
            ['phrase', '" "', 'Exact phrase'],
            ['group', '( )', 'Group'],
            ['or', 'OR', 'OR'],
            ['not', 'NOT', 'NOT'],
            ['tag', '#', 'Tag'],
        ];
        for (const [operator, text, label] of operators) {
            const buttonEl = rowEl.createEl('button', { cls: 'mobile-search-operator-btn', text });
            buttonEl.setAttribute('aria-label', label);
            buttonEl.addEventListener('mousedown', (e) => e.preventDefault());
            buttonEl.addEventListener('click', () => this.applyOperator(operator));
        }
    }

    private applyOperator(operator: Operator): void {
        const { value, selectionStart, selectionEnd } = this.inputEl;
        const edit = insertOperator(value, selectionStart ?? value.length, selectionEnd ?? value.length, operator);
        this.inputEl.value = edit.value;
        this.inputEl.setSelectionRange(edit.caret, edit.caret);
        this.executeSearch();
        this.updateClearButton();
    }

    onClose(): void {
        this.stopTrackingKeyboard?.();
        this.stopTrackingKeyboard = undefined;
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
                const snippetEl = itemEl.createDiv({ cls: 'mobile-search-result-snippet' });
                for (const piece of result.snippet) {
                    if (piece.hit) {
                        snippetEl.createSpan({ cls: 'mobile-search-snippet-hit', text: piece.text });
                    } else {
                        snippetEl.appendText(piece.text);
                    }
                }
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
        this.updateClearButton();
    }

    private updateClearButton(): void {
        this.clearEl.toggleClass('is-hidden', !this.inputEl.value);
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
