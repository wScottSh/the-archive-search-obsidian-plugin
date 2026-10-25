/**
 * Omnibar sidebar view — the core UI for The Archive Search.
 *
 * Rendering and gestures only; the search session owns all state:
 * - Persistent sidebar pane (ItemView)
 * - Text input with real-time filtering
 * - Arrow-key browsing previews the selected note in the editor
 * - Ctrl/shift-click and shift-arrow select several notes; right-click opens Obsidian's file menu
 * - Back/forward walk the queries the user paused on
 */

import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type TheArchiveSearchPlugin from '../main';
import { ObsidianWorkspace } from './obsidian-workspace';
import { SearchSession, Row } from './search-session';

export const VIEW_TYPE_OMNIBAR = 'the-archive-omnibar';

export class OmnibarView extends ItemView {
    plugin: TheArchiveSearchPlugin;

    private inputEl: HTMLInputElement;
    private resultListEl: HTMLElement;
    private navBackEl: HTMLElement;
    private navForwardEl: HTMLElement;

    private workspace: ObsidianWorkspace;
    /** The sidebar's own session; mobile keeps a separate one so each keeps its own history and selection. */
    private session: SearchSession;
    private unsubscribe: (() => void) | undefined;

    /** Row last clicked, the anchor for shift-click ranges; -1 when none. */
    private lastClickedIndex = -1;
    /** What the list last scrolled for; it follows the active row only when one of these changes. */
    private renderedQuery: string | undefined;
    private renderedActive = -1;

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
        this.navBackEl.addEventListener('click', () => this.step(() => this.session.back()));

        this.navForwardEl = navContainer.createDiv({ cls: 'omnibar-nav-btn' });
        setIcon(this.navForwardEl, 'arrow-right');
        this.navForwardEl.setAttribute('aria-label', 'Forward');
        this.navForwardEl.addEventListener('click', () => this.step(() => this.session.forward()));

        // ── Result list ──
        this.resultListEl = container.createDiv({ cls: 'omnibar-results' });

        // ── Session ──
        this.workspace = new ObsidianWorkspace(this.app, () => this.plugin.settings);
        this.session = new SearchSession(this.plugin.searchEngine, this.workspace);
        this.unsubscribe = this.session.subscribe(() => this.render());

        // ── Event listeners ──
        this.inputEl.addEventListener('input', () => {
            this.session.setQuery(this.inputEl.value);
            // An exact title makes its note the active row; show it
            this.session.activate(this.session.active);
        });

        this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                this.moveActive(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                // Enter commits to the note, so the search highlights come off
                this.session.land(undefined, { clearHighlights: true });
            } else if (e.key === 'Escape') {
                if (this.session.isSelecting) {
                    e.preventDefault();
                    this.clearSelection();
                }
            }
        });

        // Initial search (show all files)
        this.session.open(this.workspace.currentFile());
    }

    async onClose(): Promise<void> {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.workspace.clearHighlights();
    }

    /**
     * Focus the input field. Called by the hotkey command.
     * Captures the currently-open file as the pinned "Current note" unless `repin` is false.
     */
    focusInput(repin = true): void {
        if (repin) this.session.setCurrentNote(this.workspace.currentFile());
        this.inputEl?.focus();
        this.inputEl?.select();
    }

    /**
     * Set the search query programmatically (used by wiki-link handler).
     * Captures the currently-open file as the pinned "Current note".
     */
    setQuery(query: string): void {
        if (!this.inputEl) return;
        this.session.open(this.workspace.currentFile(), query);
        this.session.activate(this.session.active);
    }

    /** Run a history step, then show the note the restored entry has active. */
    private step(move: () => void): void {
        move();
        this.session.activate(this.session.active);
    }

    // ── Render ──

    private render(): void {
        const query = this.session.getQuery();
        if (this.inputEl.value !== query) this.inputEl.value = query;
        this.navBackEl.toggleClass('is-disabled', !this.session.canBack);
        this.navForwardEl.toggleClass('is-disabled', !this.session.canForward);

        this.resultListEl.empty();
        this.session.rows().forEach((row, index) => this.renderRow(row, index));

        if (query !== this.renderedQuery || this.session.active !== this.renderedActive) {
            this.resultListEl.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
        }
        this.renderedQuery = query;
        this.renderedActive = this.session.active;
    }

    private renderRow(row: Row, index: number): void {
        let cls = 'omnibar-result-item';
        if (row.kind === 'current') cls += ' omnibar-current-note-item';
        if (row.kind === 'create') cls += ' omnibar-create-item';
        if (index === this.session.active) cls += ' is-selected';
        if (this.session.isSelected(index)) cls += ' is-multi-selected';
        const itemEl = this.resultListEl.createDiv({ cls });

        if (row.kind === 'create') {
            setIcon(itemEl.createSpan({ cls: 'omnibar-create-icon' }), 'plus');
            itemEl.createSpan({ cls: 'omnibar-create-text', text: `Create new note: "${row.title}"` });
            itemEl.addEventListener('click', () => this.session.land(index));
            return;
        }

        if (row.kind === 'current') {
            setIcon(itemEl.createSpan({ cls: 'omnibar-current-note-icon' }), 'file-text');
            itemEl.createSpan({ cls: 'omnibar-result-title', text: `Current note: ${row.file.basename}` });
        } else {
            const titleEl = itemEl.createSpan({ cls: 'omnibar-result-title', text: row.result.filename });
            if (row.result.matchInFilename) titleEl.addClass('is-filename-match');
        }

        const folderPath = row.file.parent?.path || '';
        if (folderPath) itemEl.createSpan({ cls: 'omnibar-result-path', text: folderPath });

        itemEl.addEventListener('click', (e: MouseEvent) => this.handleClick(index, e));
        itemEl.addEventListener('contextmenu', (e: MouseEvent) => {
            e.preventDefault();
            // Right-clicking a note outside the selection acts on just that note
            if (!this.session.isSelected(index) && index !== this.session.active) {
                this.session.clearSelection();
                this.session.toggleSelect(index);
            }
            this.session.openFileMenu({ x: e.clientX, y: e.clientY });
        });
    }

    /** Plain click previews the note; ctrl/cmd toggles it in the selection; shift selects a range from the last click. */
    private handleClick(index: number, e: MouseEvent): void {
        if (e.ctrlKey || e.metaKey) {
            this.session.toggleSelect(index);
            this.lastClickedIndex = index;
        } else if (e.shiftKey) {
            const anchor = this.lastClickedIndex >= 0 ? this.lastClickedIndex : this.session.active;
            this.session.selectRange(anchor, index);
        } else {
            if (this.session.isSelecting) this.session.clearSelection();
            this.lastClickedIndex = index;
            this.session.activate(index);
        }
    }

    /** Arrow keys move the active row and preview it; with shift they extend the selection instead. */
    private moveActive(delta: number, shift: boolean): void {
        if (shift) {
            this.session.extendSelection(delta);
            return;
        }
        if (this.session.isSelecting) this.session.clearSelection();
        this.session.activate(this.session.active + delta);
    }

    private clearSelection(): void {
        this.lastClickedIndex = -1;
        this.session.clearSelection();
    }
}
