/**
 * Browser stand-in for the 'obsidian' module, enough to mount the real
 * MobileSearchModal, SearchSession and SearchEngine outside Obsidian.
 */

import './dom';

export class TAbstractFile {
    path = '';
}

export class TFile extends TAbstractFile {
    basename: string;
    extension = 'md';
    parent: { path: string } | null;
    stat: { ctime: number; mtime: number; size: number };

    constructor(path: string, ctime: number, mtime: number, size: number) {
        super();
        this.path = path;
        const slash = path.lastIndexOf('/');
        this.basename = path.substring(slash + 1).replace(/\.md$/, '');
        this.parent = { path: slash === -1 ? '' : path.substring(0, slash) };
        this.stat = { ctime, mtime, size };
    }
}

export class App {}
export class Plugin {}
export class ItemView {}
export class WorkspaceLeaf {}
export class Menu {}

export class MarkdownView {
    file: TFile | null = null;
    editor: unknown = null;
}

export class Notice {
    constructor(_message: string) {}
}

export const Platform = { isMobileApp: true };

export function normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
}

export function debounce<T extends (...args: any[]) => any>(fn: T): T {
    return fn;
}

const ICONS: Record<string, string> = {
    'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    'x-circle': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
    'eye': '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
};

/** Parses a fresh Lucide SVG per call, as Obsidian's own setIcon does. */
export function setIcon(el: HTMLElement, icon: string): void {
    el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-${icon}">${ICONS[icon] ?? ''}</svg>`;
}

/** Obsidian's modal DOM: container > bg + modal > close button + content. */
export class Modal {
    app: App;
    containerEl: HTMLElement;
    modalEl: HTMLElement;
    contentEl: HTMLElement;

    constructor(app: App) {
        this.app = app;
        this.containerEl = document.createElement('div');
        this.containerEl.className = 'modal-container mod-dim';
        this.containerEl.createDiv({ cls: 'modal-bg' });
        this.modalEl = this.containerEl.createDiv({ cls: 'modal' });
        this.modalEl.createDiv({ cls: 'modal-close-button' });
        this.contentEl = this.modalEl.createDiv({ cls: 'modal-content' });
    }

    open(): void {
        document.body.appendChild(this.containerEl);
        this.onOpen();
    }

    close(): void {
        this.onClose();
        this.containerEl.remove();
    }

    onOpen(): void {}
    onClose(): void {}
}
