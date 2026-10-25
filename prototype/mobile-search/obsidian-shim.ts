// PROTOTYPE — browser stand-in for the 'obsidian' module so the real SearchEngine runs outside Obsidian.

export class TAbstractFile {
    path = '';
}

export class TFile extends TAbstractFile {
    basename: string;
    extension = 'md';
    parent: { path: string } | null;
    stat: { ctime: number; mtime: number; size: number };

    constructor(path: string, ctime: number, mtime: number) {
        super();
        this.path = path;
        const slash = path.lastIndexOf('/');
        this.basename = path.substring(slash + 1).replace(/\.md$/, '');
        this.parent = { path: slash === -1 ? '' : path.substring(0, slash) };
        this.stat = { ctime, mtime, size: 0 };
    }
}

export class App {}

export function debounce<T extends (...args: any[]) => any>(fn: T): T {
    return fn;
}
