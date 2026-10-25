/**
 * Quick Look: a peek at a whole note over the mobile search surface.
 *
 * Private to the mobile modal. The note shows as plain source text with the
 * search terms highlighted and the view scrolled to the first match. Plain
 * text rather than MarkdownRenderer: the first match and every highlight map
 * straight onto the source, with no async render to wait for and no rendered
 * DOM to search through.
 */

import { App, MarkdownView, Notice, TFile, setIcon } from 'obsidian';
import { highlightPieces } from './search-session';

/** Where in the body the first match rests, as a fraction of its height. */
const MATCH_POSITION = 0.25;

/**
 * Insert a link to `file` at the cursor of the most recently used note editor,
 * which is the note being edited before search opened. The link text comes from
 * Obsidian so it follows the user's link settings. Returns whether it inserted.
 */
export function insertLink(app: App, file: TFile): boolean {
    const view = app.workspace.getMostRecentLeaf()?.view;
    if (!(view instanceof MarkdownView) || !view.file) {
        new Notice('Open a note to insert a link into');
        return false;
    }
    view.editor.replaceSelection(app.fileManager.generateMarkdownLink(file, view.file.path));
    return true;
}

/**
 * Scroll `body` so `target` sits near the top. Sets scrollTop by hand:
 * scrollIntoView also scrolls overflow:hidden ancestors, which would shove the
 * full-screen modal out of place.
 */
export function scrollToMatch(body: HTMLElement, target: HTMLElement): void {
    const offset = target.getBoundingClientRect().top - body.getBoundingClientRect().top;
    body.scrollTop = Math.max(0, body.scrollTop + offset - body.clientHeight * MATCH_POSITION);
}

/** Horizontal travel (px) that turns a drag on the body into a step. */
const SWIPE_MIN_PX = 60;
/** How much further a swipe must travel sideways than vertically to count as horizontal. */
const SWIPE_HORIZONTAL_RATIO = 2;

/**
 * Which way a drag steps: 1 for next (finger moved left), -1 for previous
 * (finger moved right), 0 when it was too short or too vertical to be a swipe.
 */
export function swipeDirection(dx: number, dy: number): -1 | 0 | 1 {
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * SWIPE_HORIZONTAL_RATIO) return 0;
    return dx < 0 ? 1 : -1;
}

/** A file row Quick Look can show: the note and where its row sits in the list. */
export interface QuickLookItem {
    file: TFile;
    index: number;
}

export interface QuickLookOptions {
    app: App;
    /** File rows only, in list order; the create row is never an item. */
    items: QuickLookItem[];
    /** Position in `items` to show first. */
    start: number;
    terms: string[];
    /** Footer Open: land on the row of the note being shown, the same as tapping it. */
    onOpen: (index: number) => void;
    /** Quick Look went away; the list underneath was never touched. */
    onClose: () => void;
}

export class QuickLook {
    private overlayEl: HTMLElement;
    private titleEl: HTMLElement;
    private positionEl: HTMLElement;
    private prevEl: HTMLElement;
    private nextEl: HTMLElement;
    private bodyEl: HTMLElement;
    private position: number;
    private closed = false;

    constructor(parent: HTMLElement, private options: QuickLookOptions) {
        this.position = options.start;
        this.overlayEl = parent.createDiv({ cls: 'mobile-search-quicklook' });

        // ── Header ──
        const headerEl = this.overlayEl.createDiv({ cls: 'mobile-search-quicklook-header' });
        this.prevEl = this.createButton(headerEl, 'chevron-left', 'Previous result', () => this.step(-1));
        this.nextEl = this.createButton(headerEl, 'chevron-right', 'Next result', () => this.step(1));
        this.titleEl = headerEl.createSpan({ cls: 'mobile-search-quicklook-title' });
        this.positionEl = headerEl.createSpan({ cls: 'mobile-search-quicklook-position' });
        this.createButton(headerEl, 'x', 'Close Quick Look', () => this.close());

        // ── Body ──
        this.bodyEl = this.overlayEl.createDiv({ cls: 'mobile-search-quicklook-body' });
        this.watchSwipe(this.bodyEl);

        // ── Footer ──
        const footerEl = this.overlayEl.createDiv({ cls: 'mobile-search-quicklook-footer' });
        this.createButton(footerEl, 'link', 'Insert link', () => {
            if (insertLink(options.app, this.current.file)) this.close();
        }, 'Insert link');
        this.createButton(footerEl, 'file-input', 'Open', () => {
            const { index } = this.current;
            this.close();
            options.onOpen(index);
        }, 'Open').addClass('mod-cta');

        this.show();
    }

    private get current(): QuickLookItem {
        return this.options.items[this.position];
    }

    /**
     * Move to the neighbouring note. Quick Look tracks its own position and
     * never previews through the workspace: on mobile that would swap the note
     * in the editor that Insert link targets.
     */
    step(direction: -1 | 1): void {
        const next = this.position + direction;
        if (this.closed || next < 0 || next >= this.options.items.length) return;
        this.position = next;
        this.show();
    }

    /** Show the current note: title, "n of N", button states, and a fresh body. */
    private show(): void {
        const { file } = this.current;
        const { items } = this.options;
        this.titleEl.setText(file.basename);
        this.positionEl.setText(`${this.position + 1} of ${items.length}`);
        this.prevEl.toggleClass('is-disabled', this.position === 0);
        this.nextEl.toggleClass('is-disabled', this.position === items.length - 1);

        this.bodyEl.empty();
        this.bodyEl.scrollTop = 0;
        // A step can land before the previous read resolves; only the latest note renders
        void this.options.app.vault.cachedRead(file).then((text) => {
            if (!this.closed && this.current.file === file) this.renderText(this.bodyEl, text);
        });
    }

    /** Horizontal swipe on the body steps; vertical drags are left to scroll the note. */
    private watchSwipe(bodyEl: HTMLElement): void {
        let startX = 0;
        let startY = 0;
        let tracking = false;
        bodyEl.addEventListener('pointerdown', (e) => {
            tracking = true;
            startX = e.clientX;
            startY = e.clientY;
        });
        bodyEl.addEventListener('pointercancel', () => {
            tracking = false;
        });
        bodyEl.addEventListener('pointerup', (e) => {
            if (!tracking) return;
            tracking = false;
            const direction = swipeDirection(e.clientX - startX, e.clientY - startY);
            if (direction !== 0) this.step(direction);
        });
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.overlayEl.remove();
        this.options.onClose();
    }

    private renderText(bodyEl: HTMLElement, text: string): void {
        for (const piece of highlightPieces(text, this.options.terms)) {
            if (piece.hit) bodyEl.createSpan({ cls: 'mobile-search-hit', text: piece.text });
            else bodyEl.appendText(piece.text);
        }
        const firstHit = bodyEl.querySelector<HTMLElement>('.mobile-search-hit');
        if (firstHit) scrollToMatch(bodyEl, firstHit);
    }

    private createButton(parent: HTMLElement, icon: string, label: string, onClick: () => void, text?: string): HTMLElement {
        const buttonEl = parent.createEl('button', { cls: 'mobile-search-quicklook-btn' });
        setIcon(buttonEl.createSpan(), icon);
        if (text) buttonEl.appendText(text);
        buttonEl.setAttribute('aria-label', label);
        buttonEl.addEventListener('click', () => {
            if (!buttonEl.hasClass('is-disabled')) onClick();
        });
        return buttonEl;
    }
}
