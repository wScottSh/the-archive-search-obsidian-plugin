/**
 * Quick Look tests: link insertion into the previously edited note and the
 * manual scroll to the first match.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MarkdownView, Notice, TFile } from 'obsidian';
import { insertLink, scrollToMatch } from '../src/quick-look';

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
