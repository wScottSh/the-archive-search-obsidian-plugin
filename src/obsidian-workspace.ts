/**
 * Obsidian adapter for the search session's workspace seam.
 *
 * The one home of "open a note, highlight matches, put the cursor on the
 * first one, focus the editor" and of note creation.
 */

import { App, MarkdownView, Menu, Notice, TFile, WorkspaceLeaf, normalizePath } from 'obsidian';
import { EditorView } from '@codemirror/view';
import type { ArchiveSearchSettings } from './settings';
import type { Workspace } from './search-session';
import { highlightInEditor, clearHighlightsInEditor } from './editor-highlight';

/** Time for a freshly opened file to load before touching its editor. */
const EDITOR_READY_MS = 120;

export class ObsidianWorkspace implements Workspace {
    constructor(private app: App, private getSettings: () => ArchiveSearchSettings) {}

    /** The note open in the main editor, if any. */
    currentFile(): TFile | null {
        const leaf = this.app.workspace.getMostRecentLeaf();
        return leaf?.view instanceof MarkdownView ? leaf.view.file : null;
    }

    preview(file: TFile, terms: string[]): void {
        const leaf = this.app.workspace.getMostRecentLeaf();
        if (!leaf) return;
        void leaf.openFile(file).then(() => {
            setTimeout(() => this.highlight(leaf, terms), EDITOR_READY_MS);
        });
    }

    land(file: TFile, terms: string[]): void {
        const leaf = this.app.workspace.getMostRecentLeaf();
        if (!leaf) return;
        void leaf.openFile(file).then(() => {
            setTimeout(() => {
                if (!(leaf.view instanceof MarkdownView)) return;
                const editor = leaf.view.editor;
                this.highlight(leaf, terms);
                const docText = editor.getValue().toLowerCase();
                let firstPos = Infinity;
                for (const term of terms) {
                    const pos = docText.indexOf(term.toLowerCase());
                    if (pos !== -1 && pos < firstPos) firstPos = pos;
                }
                if (firstPos !== Infinity) editor.setCursor(editor.offsetToPos(firstPos));
                this.app.workspace.setActiveLeaf(leaf, { focus: true });
                editor.focus();
            }, EDITOR_READY_MS);
        });
    }

    async create(title: string): Promise<void> {
        const name = title.trim();
        if (!name) return;

        const settings = this.getSettings();
        const folderPath =
            settings.newNoteLocation === 'custom' && settings.newNoteFolder ? settings.newNoteFolder : '';
        const filePath = normalizePath(folderPath ? `${folderPath}/${name}.md` : `${name}.md`);

        try {
            let file = this.app.vault.getFileByPath(filePath);
            if (!file) {
                if (folderPath && !this.app.vault.getFolderByPath(normalizePath(folderPath))) {
                    await this.app.vault.createFolder(normalizePath(folderPath));
                }
                file = await this.app.vault.create(filePath, '');
            }
            const leaf = this.app.workspace.getMostRecentLeaf();
            if (!leaf) return;
            await leaf.openFile(file);
            this.app.workspace.setActiveLeaf(leaf, { focus: true });
            setTimeout(() => {
                if (leaf.view instanceof MarkdownView) leaf.view.editor.focus();
            }, 50);
        } catch (err) {
            new Notice(`Failed to create note: ${err}`);
        }
    }

    openFileMenu(files: TFile[], position: { x: number; y: number }): void {
        if (files.length === 0) return;
        const menu = new Menu();
        if (files.length > 1) {
            this.app.workspace.trigger('files-menu', menu, files, 'the-archive-search');
        } else {
            this.app.workspace.trigger('file-menu', menu, files[0], 'the-archive-search');
        }
        menu.showAtPosition(position);
    }

    /** Remove search highlights from the note in the main editor. */
    clearHighlights(): void {
        const cm = this.editorView(this.app.workspace.getMostRecentLeaf());
        if (cm) clearHighlightsInEditor(cm);
    }

    private highlight(leaf: WorkspaceLeaf, terms: string[]): void {
        if (!this.getSettings().highlightMatches || terms.length === 0) return;
        const cm = this.editorView(leaf);
        if (cm) highlightInEditor(cm, terms);
    }

    /** The CodeMirror view of a leaf's markdown editor. Checks for MarkdownView so a sidebar with focus is never mistaken for it. */
    private editorView(leaf: WorkspaceLeaf | null): EditorView | null {
        const editor = leaf?.view instanceof MarkdownView ? leaf.view.editor : null;
        const cm = (editor as { cm?: unknown } | null)?.cm;
        return cm instanceof EditorView ? cm : null;
    }
}
