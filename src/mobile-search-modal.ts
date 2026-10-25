/**
 * Mobile-optimized full-screen search modal (Thumb Dock).
 *
 * Rendering and gestures only; the search session owns all state:
 * - A top bar holds the title, the match count and Select
 * - Results stack bottom-up so the first row sits nearest the thumb:
 *   the pinned current note right above the capsule, results reading upward
 * - Search capsule docked to the bottom edge, riding on the keyboard
 *   (back/forward, input, clear, close)
 * - Go on the keyboard opens the marked row (an exact title marks its note)
 * - Tapping a row opens the note at its first match and closes search
 * - Long-pressing a row, or Select, enters selection mode: rows show
 *   checkboxes and a selection bar replaces the capsule, with Actions opening
 *   Obsidian's own file menu for the selection
 * - The eye on a file row peeks at the whole note (Quick Look) without leaving search;
 *   it is hidden while selecting, where a tap toggles the row instead
 */

import { App, Modal, setIcon } from 'obsidian';
import type TheArchiveSearchPlugin from '../main';
import { trackKeyboard } from './keyboard-tracker';
import { insertOperator, Operator } from './operator-insert';
import { QuickLook, QuickLookItem, appendPieces } from './quick-look';
import { ObsidianWorkspace } from './obsidian-workspace';
import { SearchSession, Row } from './search-session';
import { highlightPieces } from './search-engine';

/** Finger travel (px) that turns a touch on the list into a scroll. */
const SCROLL_GESTURE_PX = 8;
/** Hold time (ms) on a row that enters selection mode. */
const LONG_PRESS_MS = 450;
/** Vibration (ms) confirming a long press, where the device supports it. */
const LONG_PRESS_VIBRATE_MS = 10;

/**
 * Pressing `el` must not take focus from the search input, or the keyboard
 * would drop. Cancelling mousedown is what Obsidian's own mobile toolbar does.
 */
function keepFocus(el: HTMLElement): void {
    el.addEventListener('mousedown', (e) => e.preventDefault());
}

export class MobileSearchModal extends Modal {
    private plugin: TheArchiveSearchPlugin;
    private session: SearchSession;
    private inputEl: HTMLInputElement;
    private resultListEl: HTMLElement;
    private navBackEl: HTMLElement;
    private navForwardEl: HTMLElement;
    private clearEl: HTMLElement;
    private matchCountEl: HTMLElement;
    private selectEl: HTMLElement;
    private selectionCountEl: HTMLElement;
    private actionsEl: HTMLElement;
    private stopTrackingKeyboard: (() => void) | undefined;
    private unsubscribe: (() => void) | undefined;
    private stopWatchingNotes: (() => void) | undefined;
    private quickLook: QuickLook | undefined;

    private initialQuery: string | undefined;
    /** Query the list was last rendered for; the list returns to the thumb when it changes. */
    private renderedQuery: string | undefined;
    /** Set by a long press so the click that ends it does not also act; the next press resets it. */
    private suppressClick = false;

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

        // ── Top bar ──
        const topBarEl = contentEl.createDiv({ cls: 'mobile-search-top-bar' });
        topBarEl.createSpan({ cls: 'mobile-search-title', text: 'Search' });
        this.matchCountEl = topBarEl.createSpan({ cls: 'mobile-search-match-count' });
        this.selectEl = topBarEl.createEl('button', { cls: 'mobile-search-select-btn', text: 'Select' });
        this.selectEl.addEventListener('click', () => {
            if (this.session.isSelecting) {
                this.session.clearSelection();
            } else {
                this.inputEl.blur();
                this.session.beginSelect();
            }
        });

        // ── Result list (laid out bottom-up by CSS) ──
        this.resultListEl = contentEl.createDiv({ cls: 'mobile-search-results' });
        this.watchListScroll();

        // ── Dock: capsule at the bottom edge ──
        const dockEl = contentEl.createDiv({ cls: 'mobile-search-dock' });
        this.createOperatorRow(dockEl);
        const capsuleEl = dockEl.createDiv({ cls: 'mobile-search-capsule' });

        this.navBackEl = this.createIconButton(capsuleEl, 'arrow-left', 'Back', () => this.session.back());
        this.navForwardEl = this.createIconButton(capsuleEl, 'arrow-right', 'Forward', () => this.session.forward());

        // Search input
        this.inputEl = capsuleEl.createEl('input', {
            type: 'text',
            placeholder: 'Search...',
            cls: 'mobile-search-input',
            attr: { autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false' },
        });
        // The keyboard's action key reads Go and opens the marked row
        this.inputEl.enterKeyHint = 'go';
        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
            e.preventDefault();
            // Nothing to open (an empty vault): stay in search
            if (!this.session.rows()[this.session.active]) return;
            this.session.land();
            this.exit();
        });

        this.clearEl = this.createIconButton(capsuleEl, 'x-circle', 'Clear', () => {
            this.inputEl.value = '';
            this.session.setQuery('');
            this.inputEl.focus();
        });

        this.createIconButton(capsuleEl, 'x', 'Close', () => this.exit());
        this.createSelectionBar(dockEl);

        // ── Session ──
        const workspace = new ObsidianWorkspace(this.app, () => this.plugin.settings);
        this.plugin.mobileSession ??= new SearchSession(this.plugin.searchEngine, workspace);
        this.session = this.plugin.mobileSession;
        this.unsubscribe = this.session.subscribe(() => this.render());
        this.inputEl.addEventListener('input', () => this.session.setQuery(this.inputEl.value));
        this.session.open(workspace.currentFile(), this.initialQuery);
        // A note deleted or renamed through Actions must leave the list
        this.stopWatchingNotes = this.plugin.searchEngine.onNoteRemoved(() => this.session.refresh());

        this.stopTrackingKeyboard = trackKeyboard(modalEl);

        // Must happen synchronously inside the user's tap or iOS will not raise the keyboard
        this.inputEl.focus();
    }

    /**
     * Capsule button. Pressing it keeps the keyboard up.
     */
    private createIconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLElement {
        const buttonEl = parent.createEl('button', { cls: 'mobile-search-icon-btn' });
        setIcon(buttonEl, icon);
        buttonEl.setAttribute('aria-label', label);
        keepFocus(buttonEl);
        buttonEl.addEventListener('click', onClick);
        return buttonEl;
    }

    /** Selection bar: replaces the capsule while selecting. */
    private createSelectionBar(parent: HTMLElement): void {
        const barEl = parent.createDiv({ cls: 'mobile-search-selection-bar' });
        this.selectionCountEl = barEl.createSpan({ cls: 'mobile-search-selection-count' });
        const addButton = (text: string, onClick: (buttonEl: HTMLElement) => void): HTMLElement => {
            const buttonEl = barEl.createEl('button', { cls: 'mobile-search-selection-btn', text });
            buttonEl.addEventListener('click', () => onClick(buttonEl));
            return buttonEl;
        };
        addButton('Select all', () => this.session.selectAll());
        this.actionsEl = addButton('Actions', (buttonEl) => {
            // With nothing selected the session would target the active row instead
            if (this.session.selectionCount === 0) return;
            const rect = buttonEl.getBoundingClientRect();
            this.session.openFileMenu({ x: rect.left + rect.width / 2, y: rect.top });
        });
        this.actionsEl.addClass('is-primary');
        addButton('Cancel', () => this.session.clearSelection());
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
            keepFocus(buttonEl);
            buttonEl.addEventListener('click', () => this.applyOperator(operator));
        }
    }

    private applyOperator(operator: Operator): void {
        const { value, selectionStart, selectionEnd } = this.inputEl;
        const edit = insertOperator(value, selectionStart ?? value.length, selectionEnd ?? value.length, operator);
        this.inputEl.value = edit.value;
        this.inputEl.setSelectionRange(edit.caret, edit.caret);
        this.session.setQuery(edit.value);
    }

    /**
     * Escape and Android back both arrive here, so one press backs out one
     * level: Quick Look, then selection, then the search itself. (Obsidian's
     * back button calls the top closeable's `onHistoryBack`, which for a Modal
     * is `this.close()`; the modal leaves that stack only in `super.close()`.)
     */
    close(): void {
        if (this.quickLook) this.quickLook.close();
        else if (this.session?.isSelecting) this.session.clearSelection();
        else super.close();
    }

    /** Leave search outright, whatever is open on top of it. */
    private exit(): void {
        super.close();
    }

    onClose(): void {
        this.quickLook?.close();
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.stopWatchingNotes?.();
        this.stopWatchingNotes = undefined;
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
        const selecting = this.session.isSelecting;
        this.contentEl.toggleClass('is-selecting', selecting);
        this.selectEl.setText(selecting ? 'Done' : 'Select');
        this.matchCountEl.setText(this.matchCount(query));
        this.selectionCountEl.setText(`${this.session.selectionCount} selected`);
        this.actionsEl.toggleClass('is-disabled', this.session.selectionCount === 0);
        this.renderList();
    }

    private renderList(): void {
        const query = this.session.getQuery();
        const rows = this.session.rows();
        const terms = this.session.terms();
        const showEmpty = query.trim() !== '' && !rows.some((row) => row.kind === 'result');

        // Rebuilding the list would otherwise jump it back to the thumb end on every toggle
        const scrollTop = this.resultListEl.scrollTop;
        this.resultListEl.empty();
        // Recents sit just past the pinned current note, or nearest the thumb without one
        const showRecents = query.trim() === '';
        const pinned = rows[0]?.kind === 'current';
        if (showRecents && !pinned) this.renderRecents();
        rows.forEach((row, index) => {
            if (row.kind === 'create' && showEmpty) {
                this.resultListEl.createDiv({ cls: 'mobile-search-empty', text: 'No notes match' });
            }
            this.renderRow(row, index, terms);
            if (showRecents && pinned && index === 0) this.renderRecents();
        });

        // The list is anchored to the thumb end; a new query starts there
        this.resultListEl.scrollTop = query !== this.renderedQuery ? 0 : scrollTop;
        this.renderedQuery = query;
    }

    /** "3 matches" for a query, "120 notes" for the full list. */
    private matchCount(query: string): string {
        const count = this.session.rows().filter((row) => row.kind === 'result').length;
        const noun = query.trim() ? (count === 1 ? 'match' : 'matches') : count === 1 ? 'note' : 'notes';
        return `${count} ${noun}`;
    }

    /** Recent-query chips in one scrolling row, newest first. */
    private renderRecents(): void {
        const recents = this.session.recentQueries();
        if (recents.length === 0) return;
        const chipsEl = this.resultListEl.createDiv({ cls: 'mobile-search-recents' });
        for (const recent of recents) {
            const chipEl = chipsEl.createEl('button', { cls: 'mobile-search-chip', text: recent });
            keepFocus(chipEl);
            chipEl.addEventListener('click', () => this.session.setQuery(recent));
        }
    }

    private renderRow(row: Row, index: number, terms: string[]): void {
        const cls = `mobile-search-row mobile-search-row-${row.kind}`;
        const rowEl = this.resultListEl.createDiv({ cls });
        if (index === this.session.active) rowEl.addClass('is-active');
        if (row.kind !== 'create') this.watchLongPress(rowEl, index);
        rowEl.addEventListener('click', () => {
            if (this.suppressClick) {
                this.suppressClick = false;
                return;
            }
            if (this.session.isSelecting) {
                this.session.toggleSelect(index);
                return;
            }
            this.session.land(index);
            this.exit();
        });

        if (this.session.isSelecting && row.kind !== 'create') {
            const checkboxEl = rowEl.createEl('input', { type: 'checkbox', cls: 'mobile-search-row-checkbox' });
            checkboxEl.checked = this.session.isSelected(index);
            rowEl.toggleClass('is-multi-selected', checkboxEl.checked);
        }

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
            appendPieces(titleEl, highlightPieces(row.result.filename, terms));
            if (row.result.matchInFilename) titleEl.addClass('is-filename-match');
        }

        const folder = row.file.parent?.path || '';
        if (folder) rowEl.createSpan({ cls: 'mobile-search-row-folder', text: folder });
        if (!this.session.isSelecting) this.createEyeButton(rowEl, index, terms);

        if (row.kind === 'result' && this.plugin.settings.showMobilePreviews && row.result.snippet) {
            appendPieces(rowEl.createDiv({ cls: 'mobile-search-row-snippet' }), row.result.snippet);
        }
    }

    /** Eye on a file row: peek at the note. Does not select the row or touch the keyboard. */
    private createEyeButton(rowEl: HTMLElement, index: number, terms: string[]): void {
        const eyeEl = rowEl.createEl('button', { cls: 'mobile-search-eye-btn' });
        setIcon(eyeEl, 'eye');
        eyeEl.setAttribute('aria-label', 'Quick Look');
        keepFocus(eyeEl);
        // Keep the row's long-press from starting under the eye
        eyeEl.addEventListener('pointerdown', (e) => e.stopPropagation());
        eyeEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openQuickLook(index, terms);
        });
    }

    private openQuickLook(index: number, terms: string[]): void {
        this.quickLook?.close();
        this.inputEl.blur();
        // File rows only: stepping skips the create row
        const items: QuickLookItem[] = [];
        this.session.rows().forEach((row, rowIndex) => {
            if (row.kind !== 'create') items.push({ file: row.file, index: rowIndex });
        });
        this.quickLook = new QuickLook(this.contentEl, {
            app: this.app,
            items,
            start: items.findIndex((item) => item.index === index),
            terms,
            onOpen: (rowIndex) => {
                this.session.land(rowIndex);
                this.exit();
            },
            onClose: () => {
                this.quickLook = undefined;
            },
        });
    }

    /**
     * Holding a row selects it. Pointer events cover touch and pen as well as mouse;
     * moving past the scroll threshold or lifting early cancels.
     */
    private watchLongPress(rowEl: HTMLElement, index: number): void {
        let timer: number | undefined;
        let startX = 0;
        let startY = 0;
        const cancel = () => {
            window.clearTimeout(timer);
            timer = undefined;
        };

        rowEl.addEventListener('pointerdown', (e) => {
            this.suppressClick = false;
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            startX = e.clientX;
            startY = e.clientY;
            timer = window.setTimeout(() => {
                timer = undefined;
                this.suppressClick = true;
                navigator.vibrate?.(LONG_PRESS_VIBRATE_MS);
                this.inputEl.blur();
                this.session.toggleSelect(index);
            }, LONG_PRESS_MS);
        });
        rowEl.addEventListener('pointermove', (e) => {
            if (Math.hypot(e.clientX - startX, e.clientY - startY) > SCROLL_GESTURE_PX) cancel();
        });
        for (const type of ['pointerup', 'pointercancel', 'pointerleave']) rowEl.addEventListener(type, cancel);
        // Android shows its own menu on a long press
        rowEl.addEventListener('contextmenu', (e) => e.preventDefault());
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
