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

export interface QuickLookOptions {
    app: App;
    file: TFile;
    terms: string[];
    /** Footer Open: land on the note, the same as tapping its row. */
    onOpen: () => void;
    /** Quick Look went away; the list underneath was never touched. */
    onClose: () => void;
}

export class QuickLook {
    private overlayEl: HTMLElement;
    private closed = false;

    constructor(parent: HTMLElement, private options: QuickLookOptions) {
        const { file } = options;
        this.overlayEl = parent.createDiv({ cls: 'mobile-search-quicklook' });

        // ── Header ──
        const headerEl = this.overlayEl.createDiv({ cls: 'mobile-search-quicklook-header' });
        headerEl.createSpan({ cls: 'mobile-search-quicklook-title', text: file.basename });
        // Prev/next stepping between results (#12) belongs here, beside the title
        this.createButton(headerEl, 'x', 'Close Quick Look', () => this.close());

        // ── Body ──
        const bodyEl = this.overlayEl.createDiv({ cls: 'mobile-search-quicklook-body' });
        void options.app.vault.cachedRead(file).then((text) => {
            if (!this.closed) this.renderText(bodyEl, text);
        });

        // ── Footer ──
        const footerEl = this.overlayEl.createDiv({ cls: 'mobile-search-quicklook-footer' });
        this.createButton(footerEl, 'link', 'Insert link', () => {
            if (insertLink(options.app, file)) this.close();
        }, 'Insert link');
        this.createButton(footerEl, 'file-input', 'Open', () => {
            this.close();
            options.onOpen();
        }, 'Open').addClass('mod-cta');
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
        buttonEl.addEventListener('click', onClick);
        return buttonEl;
    }
}
