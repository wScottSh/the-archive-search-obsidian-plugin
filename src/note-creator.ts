/**
 * Note creator: generates a new note from an Omnibar search term.
 *
 * Filename format: {ID_PREFIX}{SEPARATOR}{search_term}.md
 * Created in the folder specified by settings.
 * Uses Obsidian's built-in moment.js for timestamp formatting.
 */

import { App, TFile, normalizePath, moment } from 'obsidian';
import type { ArchiveSearchSettings } from './settings';

/**
 * Generate a timestamp prefix based on the configured Moment.js format.
 */
function generateIdPrefix(format: string): string {
    if (!format) return '';
    return moment().format(format);
}

/**
 * Create a new note from the given title string.
 * Returns the created TFile, or null if creation failed.
 */
export async function createNoteFromSearch(
    app: App,
    title: string,
    settings: ArchiveSearchSettings
): Promise<TFile | null> {
    const prefix = generateIdPrefix(settings.idFormat);
    const separator = prefix ? settings.idSeparator : '';
    const safeName = title.replace(/[\\/:*?"<>|]/g, ''); // strip illegal filename chars
    const fileName = `${prefix}${separator}${safeName}.md`;

    let folder = settings.newNotePath || '';
    if (folder && !folder.endsWith('/')) {
        folder += '/';
    }

    const fullPath = normalizePath(`${folder}${fileName}`);

    try {
        // Check if file already exists
        const existing = app.vault.getAbstractFileByPath(fullPath);
        if (existing instanceof TFile) {
            return existing; // Just return the existing file
        }

        // Ensure the folder exists
        if (folder) {
            const folderPath = normalizePath(folder);
            const folderExists = app.vault.getAbstractFileByPath(folderPath);
            if (!folderExists) {
                await app.vault.createFolder(folderPath);
            }
        }

        const file = await app.vault.create(fullPath, '');
        return file;
    } catch (e) {
        console.error('The Archive Search: failed to create note', e);
        return null;
    }
}
