/**
 * Mock for the 'obsidian' module used in tests.
 * Provides minimal stubs for the types and functions used by the search engine.
 */

export class TFile {
    path: string;
    basename: string;
    extension: string;

    constructor(path: string = '', basename: string = '', extension: string = 'md') {
        this.path = path;
        this.basename = basename;
        this.extension = extension;
    }
}

export class TAbstractFile {
    path: string;
    constructor(path: string = '') {
        this.path = path;
    }
}

export function debounce<T extends (...args: any[]) => any>(
    fn: T,
    delay: number,
    immediate?: boolean
): T {
    return fn; // In tests, just pass through
}

export function normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
}

export class App { }
export class Plugin { }
export class PluginSettingTab { }
export class Setting { }
export class ItemView { }
export class WorkspaceLeaf { }
export class MarkdownPostProcessorContext { }

export function setIcon(el: HTMLElement, icon: string): void { }

export class MarkdownView {
    file: TFile | null = null;
    editor: any = null;
}

export class Notice {
    static messages: string[] = [];
    constructor(message: string) {
        Notice.messages.push(message);
    }
}
