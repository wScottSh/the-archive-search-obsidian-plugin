/**
 * Mobile-optimized full-screen search modal (Thumb Dock).
 *
 * Rendering and gestures only; the search session owns all state:
 * - Results stack bottom-up so the first row sits nearest the thumb:
 *   the pinned current note right above the capsule, results reading upward
 * - Search capsule docked to the bottom edge, riding on the keyboard
 *   (back/forward, input, clear, close)
 * - Tapping a row opens the note at its first match and closes search
 */

import { App, Modal, setIcon } from 'obsidian';
import type TheArchiveSearchPlugin from '../main';
import { trackKeyboard } from './keyboard-tracker';
import { ObsidianWorkspace } from './obsidian-workspace';
import { SearchSession, Row, highlightPieces } from './search-session';
import type { SnippetPiece } from './search-engine';

/** Finger travel (px) that turns a touch on the list into a scroll. */
const SCROLL_GESTURE_PX = 8;

export class MobileSearchModal extends Modal {
    private plugin: TheArchiveSearchPlugin;
    private session: SearchSession;
    private inputEl: HTMLInputElement;
    private resultListEl: HTMLElement;
    private navBackEl: HTMLElement;
    private navForwardEl: HTMLElement;
    private clearEl: HTMLElement;
    private stopTrackingKeyboard: (() => void) | undefined;
    private unsubscribe: (() => void) | undefined;

    private initialQuery: string | undefined;
    /** Query the list was last rendered for; the list returns to the thumb when it changes. */
    private renderedQuery: string | undefined;

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

        // ── Result list (laid out bottom-up by CSS) ──
        this.resultListEl = contentEl.createDiv({ cls: 'mobile-search-results' });
        this.watchListScroll();

        // ── Dock: capsule at the bottom edge ──
        const dockEl = contentEl.createDiv({ cls: 'mobile-search-dock' });
        const capsuleEl = dockEl.createDiv({ cls: 'mobile-search-capsule' });

        this.navBackEl = this.createIconButton(capsuleEl, 'arrow-left', 'Back', () => this.session.back());
        this.navForwardEl = this.createIconButton(capsuleEl, 'arrow-right', 'Forward', () => this.session.forward());

        // Search input
        this.inputEl = capsuleEl.createEl('input', {
            type: 'text',
            placeholder: 'Search...',
            cls: 'mobile-search-input',
        });

        this.clearEl = this.createIconButton(capsuleEl, 'x-circle', 'Clear', () => {
            this.inputEl.value = '';
            this.session.setQuery('');
            this.inputEl.focus();
        });

        this.createIconButton(capsuleEl, 'x', 'Close', () => this.close());

        // ── Session ──
        const workspace = new ObsidianWorkspace(this.app, () => this.plugin.settings);
        this.session = new SearchSession(this.plugin.searchEngine, workspace);
        this.unsubscribe = this.session.subscribe(() => this.render());
        this.inputEl.addEventListener('input', () => this.session.setQuery(this.inputEl.value));
        this.session.open(workspace.currentFile(), this.initialQuery);

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

    onClose(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.stopTrackingKeyboard?.();
        this.stopTrackingKeyboard = undefined;
        this.contentEl.empty();
    }

    // ── Render ──

    private render(): void {
        const query = this.session.getQuery();
        if (this.inputEl.value !== query) this.inputEl.value = query;
        this.clearEl.toggleClass('is-hidden', !query);
        this.navBackEl.toggleClass('is-disabled', !this.session.canBack);
        this.navForwardEl.toggleClass('is-disabled', !this.session.canForward);
        this.renderList();
    }

    private renderList(): void {
        const query = this.session.getQuery();
        const rows = this.session.rows();
        const terms = this.session.terms();
        const showEmpty = query.trim() !== '' && !rows.some((row) => row.kind === 'result');

        this.resultListEl.empty();
        rows.forEach((row, index) => {
            if (row.kind === 'create' && showEmpty) {
                this.resultListEl.createDiv({ cls: 'mobile-search-empty', text: 'No notes match' });
            }
            this.renderRow(row, index, terms);
        });

        // The list is anchored to the thumb end; a new query starts there
        if (query !== this.renderedQuery) this.resultListEl.scrollTop = 0;
        this.renderedQuery = query;
    }

    private renderRow(row: Row, index: number, terms: string[]): void {
        const cls = `mobile-search-row mobile-search-row-${row.kind}`;
        const rowEl = this.resultListEl.createDiv({ cls });
        rowEl.addEventListener('click', () => {
            this.session.land(index);
            this.close();
        });

        if (row.kind === 'create') {
            setIcon(rowEl.createSpan({ cls: 'mobile-search-row-icon' }), 'plus');
            rowEl.createSpan({ cls: 'mobile-search-row-title', text: `Create new note: "${row.title}"` });
            return;
        }

        if (row.kind === 'current') {
            setIcon(rowEl.createSpan({ cls: 'mobile-search-row-icon' }), 'file-text');
        }
        const titleEl = rowEl.createSpan({ cls: 'mobile-search-row-title' });
        if (row.kind === 'current') {
            titleEl.setText(`Current note: ${row.file.basename}`);
        } else {
            this.appendPieces(titleEl, highlightPieces(row.result.filename, terms));
            if (row.result.matchInFilename) titleEl.addClass('is-filename-match');
        }

        const folder = row.file.parent?.path || '';
        if (folder) rowEl.createSpan({ cls: 'mobile-search-row-folder', text: folder });

        if (row.kind === 'result' && this.plugin.settings.showMobilePreviews && row.result.snippet) {
            this.appendPieces(rowEl.createDiv({ cls: 'mobile-search-row-snippet' }), row.result.snippet);
        }
    }

    private appendPieces(parent: HTMLElement, pieces: SnippetPiece[]): void {
        for (const piece of pieces) {
            if (piece.hit) parent.createSpan({ cls: 'mobile-search-hit', text: piece.text });
            else parent.appendText(piece.text);
        }
    }

    /**
     * Dragging the list puts the keyboard away. Driven by touch rather than
     * scroll events, which also fire when a new query re-renders the list.
     */
    private watchListScroll(): void {
        let startY = 0;
        this.resultListEl.addEventListener('touchstart', (e) => {
            startY = e.touches[0].clientY;
        }, { passive: true });
        this.resultListEl.addEventListener('touchmove', (e) => {
            if (Math.abs(e.touches[0].clientY - startY) > SCROLL_GESTURE_PX && document.activeElement === this.inputEl) {
                this.inputEl.blur();
            }
        }, { passive: true });
    }
}
