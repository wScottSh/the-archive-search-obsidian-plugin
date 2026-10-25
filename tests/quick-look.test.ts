/**
 * Quick Look tests: link insertion into the previously edited note and the
 * manual scroll to the first match.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MarkdownView, Notice, TFile } from 'obsidian';
import { QuickLook, insertLink, scrollToMatch, swipeDirection } from '../src/quick-look';

function makeFile(path: string): TFile {
    const basename = path.replace(/\.md$/, '');
    return new (TFile as any)(path, basename, 'md') as TFile;
}

function makeApp(view: unknown) {
    const generated: Array<[string, string]> = [];
    const app = {
        workspace: { getMostRecentLeaf: () => (view === undefined ? null : { view }) },
        fileManager: {
            generateMarkdownLink: (file: TFile, sourcePath: string) => {
                generated.push([file.path, sourcePath]);
                return `[[${file.basename}]]`;
            },
        },
    };
    return { app: app as any, generated };
}

function makeMarkdownView(path: string) {
    const view = new (MarkdownView as any)() as MarkdownView;
    view.file = makeFile(path);
    const inserted: string[] = [];
    (view as any).editor = { replaceSelection: (text: string) => inserted.push(text) };
    return { view, inserted };
}

describe('insertLink', () => {
    beforeEach(() => {
        (Notice as any).messages = [];
    });

    it('inserts the generated link into the editor of the most recent note', () => {
        const { view, inserted } = makeMarkdownView('Daily/today.md');
        const { app, generated } = makeApp(view);

        expect(insertLink(app, makeFile('Ideas.md'))).toBe(true);
        expect(inserted).toEqual(['[[Ideas]]']);
        // Link settings are resolved relative to the note being edited
        expect(generated).toEqual([['Ideas.md', 'Daily/today.md']]);
    });

    it('inserts nothing and tells the user when the last leaf is not a note', () => {
        const { app } = makeApp({});
        expect(insertLink(app, makeFile('Ideas.md'))).toBe(false);
        expect((Notice as any).messages).toEqual(['Open a note to insert a link into']);
    });

    it('does not link a note into itself', () => {
        const { view, inserted } = makeMarkdownView('Ideas.md');
        const { app } = makeApp(view);
        expect(insertLink(app, makeFile('Ideas.md'))).toBe(false);
        expect(inserted).toEqual([]);
        expect((Notice as any).messages).toEqual(['A note cannot link to itself']);
    });

    it('inserts nothing when there is no leaf', () => {
        const { app } = makeApp(undefined);
        expect(insertLink(app, makeFile('Ideas.md'))).toBe(false);
    });
});

describe('scrollToMatch', () => {
    const el = (top: number, extra: object = {}) =>
        ({ getBoundingClientRect: () => ({ top }), ...extra }) as unknown as HTMLElement;

    it('sets scrollTop so the match lands near the top of the body', () => {
        const body = el(100, { scrollTop: 50, clientHeight: 400 });
        scrollToMatch(body, el(900));
        // 50 + (900 - 100) - 400 * 0.25
        expect(body.scrollTop).toBe(750);
    });

    it('does not scroll above the start', () => {
        const body = el(100, { scrollTop: 0, clientHeight: 400 });
        scrollToMatch(body, el(120));
        expect(body.scrollTop).toBe(0);
    });
});

describe('swipeDirection', () => {
    it('steps next on a long leftward drag and previous on a rightward one', () => {
        expect(swipeDirection(-80, 5)).toBe(1);
        expect(swipeDirection(80, -5)).toBe(-1);
    });

    it('ignores short drags', () => {
        expect(swipeDirection(-59, 0)).toBe(0);
        expect(swipeDirection(30, 0)).toBe(0);
    });

    it('ignores drags that are not mostly horizontal', () => {
        expect(swipeDirection(-100, 80)).toBe(0);
        expect(swipeDirection(100, 60)).toBe(0);
    });
});

/** Just enough DOM, with Obsidian's element helpers, to drive QuickLook in node. */
class FakeEl {
    children: FakeEl[] = [];
    classes = new Set<string>();
    attrs: Record<string, string> = {};
    listeners: Record<string, Array<(e: any) => void>> = {};
    text = '';
    scrollTop = 0;
    removed = false;
    constructor(cls?: string) {
        if (cls) cls.split(' ').forEach((c) => this.classes.add(c));
    }
    createEl(_tag: string, o: { cls?: string; text?: string } = {}) {
        const el = new FakeEl(o.cls);
        el.text = o.text ?? '';
        this.children.push(el);
        return el;
    }
    createDiv(o?: { cls?: string; text?: string }) { return this.createEl('div', o); }
    createSpan(o?: { cls?: string; text?: string }) { return this.createEl('span', o); }
    appendText(text: string) { this.text += text; }
    setText(text: string) { this.text = text; }
    setAttribute(k: string, v: string) { this.attrs[k] = v; }
    addClass(c: string) { this.classes.add(c); }
    hasClass(c: string) { return this.classes.has(c); }
    toggleClass(c: string, on: boolean) { on ? this.classes.add(c) : this.classes.delete(c); }
    empty() { this.children = []; this.text = ''; }
    remove() { this.removed = true; }
    querySelector() { return null; }
    addEventListener(type: string, fn: (e: any) => void) { (this.listeners[type] ??= []).push(fn); }
    fire(type: string, e: object = {}) { this.listeners[type]?.forEach((fn) => fn(e)); }
    find(cls: string): FakeEl | undefined {
        if (this.classes.has(cls)) return this;
        for (const child of this.children) {
            const found = child.find(cls);
            if (found) return found;
        }
    }
    byLabel(label: string): FakeEl {
        const walk = (el: FakeEl): FakeEl | undefined =>
            el.attrs['aria-label'] === label ? el : el.children.map(walk).find(Boolean);
        return walk(this)!;
    }
}

describe('QuickLook stepping', () => {
    const files = ['A', 'B', 'C'].map((n) => makeFile(`${n}.md`));
    // Row 0 is the current-note row; a create row after them is never an item
    const items = files.map((file, i) => ({ file, index: i }));

    function open(start: number, view?: unknown) {
        const reads: Array<{ path: string; resolve: (text: string) => void; reject: (err: Error) => void }> = [];
        const { app } = makeApp(view);
        app.vault = {
            cachedRead: (file: TFile) =>
                new Promise<string>((resolve, reject) => reads.push({ path: file.path, resolve, reject })),
        };
        const parent = new FakeEl();
        const opened: number[] = [];
        let closed = 0;
        new QuickLook(parent as any, {
            app, items, start, terms: [],
            onOpen: (index) => opened.push(index),
            onClose: () => closed++,
        });
        return { overlay: parent.children[0], reads, opened, closedCount: () => closed };
    }

    const label = (o: FakeEl) => o.find('mobile-search-quicklook-position')!.text;
    const title = (o: FakeEl) => o.find('mobile-search-quicklook-title')!.text;

    it('shows "n of N" over file rows and steps with the buttons', () => {
        const { overlay } = open(0);
        expect(label(overlay)).toBe('1 of 3');
        expect(title(overlay)).toBe('A');
        overlay.byLabel('Next result').fire('click');
        expect(label(overlay)).toBe('2 of 3');
        expect(title(overlay)).toBe('B');
        overlay.byLabel('Previous result').fire('click');
        expect(title(overlay)).toBe('A');
    });

    it('disables prev at the start and next at the end, and does not step past them', () => {
        const { overlay } = open(0);
        expect(overlay.byLabel('Previous result').hasClass('is-disabled')).toBe(true);
        overlay.byLabel('Previous result').fire('click');
        expect(label(overlay)).toBe('1 of 3');

        const last = open(2).overlay;
        expect(last.byLabel('Next result').hasClass('is-disabled')).toBe(true);
        last.byLabel('Next result').fire('click');
        expect(label(last)).toBe('3 of 3');
    });

    it('steps on a horizontal swipe and not on a vertical scroll', () => {
        const { overlay } = open(1);
        const body = overlay.find('mobile-search-quicklook-body')!;
        const drag = (dx: number, dy: number) => {
            body.fire('pointerdown', { clientX: 200, clientY: 300 });
            body.fire('pointerup', { clientX: 200 + dx, clientY: 300 + dy });
        };
        drag(0, 150);
        expect(title(overlay)).toBe('B');
        drag(-90, 10);
        expect(title(overlay)).toBe('C');
        drag(90, 10);
        expect(title(overlay)).toBe('B');
    });

    it('opens the row of the note being shown', () => {
        const { overlay, opened, closedCount } = open(0);
        overlay.byLabel('Next result').fire('click');
        overlay.byLabel('Open').fire('click');
        expect(opened).toEqual([1]);
        expect(closedCount()).toBe(1);
    });

    it('inserts a link to the note being shown', () => {
        const { view, inserted } = makeMarkdownView('Daily/today.md');
        const { overlay, closedCount } = open(0, view);
        overlay.byLabel('Next result').fire('click');
        overlay.byLabel('Insert link').fire('click');
        expect(inserted).toEqual(['[[B]]']);
        expect(closedCount()).toBe(1);
    });

    it('renders only the latest note when an earlier read resolves late', async () => {
        const { overlay, reads } = open(0);
        overlay.byLabel('Next result').fire('click');
        reads[0].resolve('stale text');
        reads[1].resolve('fresh text');
        await Promise.resolve();
        await Promise.resolve();
        expect(overlay.find('mobile-search-quicklook-body')!.text).toBe('fresh text');
    });

    it('says so when the note cannot be read', async () => {
        const { overlay, reads } = open(0);
        reads[0].reject(new Error('gone'));
        await Promise.resolve();
        await Promise.resolve();
        expect(overlay.find('mobile-search-quicklook-body')!.text).toBe('Could not read this note');
    });
});
