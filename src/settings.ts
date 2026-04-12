/**
 * Plugin settings for The Archive Search.
 *
 * Implements Obsidian-native patterns:
 * - AbstractInputSuggest for folder pickers
 * - addMomentFormat for date format with live preview
 * - Dynamic add/remove lists for excluded folders
 * - Proper section grouping with setHeading()
 */

import {
    App,
    PluginSettingTab,
    Setting,
    AbstractInputSuggest,
    TFolder,
} from 'obsidian';
import type TheArchiveSearchPlugin from '../main';

// ─── Sort order options ──────────────────────────────────────────

export type SortOrder =
    | 'a-z'
    | 'z-a'
    | 'created-new'
    | 'created-old'
    | 'modified-new'
    | 'modified-old';

export const SORT_ORDER_LABELS: Record<SortOrder, string> = {
    'a-z': 'Alphabetical (A → Z)',
    'z-a': 'Alphabetical (Z → A)',
    'created-new': 'Date created (newest first)',
    'created-old': 'Date created (oldest first)',
    'modified-new': 'Date modified (newest first)',
    'modified-old': 'Date modified (oldest first)',
};

// ─── Settings interface ──────────────────────────────────────────

export interface ArchiveSearchSettings {
    /** Moment.js format string for new note IDs. Empty = no prefix. */
    idFormat: string;
    /** Separator between ID prefix and title */
    idSeparator: string;
    /** Whether wiki-link clicks redirect to the Omnibar */
    interceptWikiLinks: boolean;
    /** Folder path for newly created notes (relative to vault root) */
    newNotePath: string;
    /** Highlight search terms in the editor */
    highlightMatches: boolean;
    /** Sort order for search results */
    sortOrder: SortOrder;
    /** Omnibar sidebar position */
    omnibarPosition: 'left' | 'right';
    /** Show ribbon icon */
    showRibbonIcon: boolean;
    /** Respect Obsidian's native excluded files setting */
    respectObsidianExcluded: boolean;
    /** Plugin-specific folder exclusions */
    excludedFolders: string[];
}

export const DEFAULT_SETTINGS: ArchiveSearchSettings = {
    idFormat: 'YYYYMMDDHHmm',
    idSeparator: ' ',
    interceptWikiLinks: true,
    newNotePath: '',
    highlightMatches: true,
    sortOrder: 'a-z',
    omnibarPosition: 'right',
    showRibbonIcon: true,
    respectObsidianExcluded: true,
    excludedFolders: [],
};

// ─── Folder autocomplete suggest ─────────────────────────────────

class FolderSuggest extends AbstractInputSuggest<string> {
    private textInputEl: HTMLInputElement;

    constructor(app: App, inputEl: HTMLInputElement) {
        super(app, inputEl);
        this.textInputEl = inputEl;
    }

    getSuggestions(query: string): string[] {
        const lowerQuery = query.toLowerCase();
        return this.app.vault
            .getAllLoadedFiles()
            .filter((f): f is TFolder => f instanceof TFolder)
            .map((f) => f.path)
            .filter((p) => p.toLowerCase().includes(lowerQuery))
            .sort();
    }

    renderSuggestion(folder: string, el: HTMLElement): void {
        el.createEl('div', { text: folder || '(vault root)' });
    }

    selectSuggestion(folder: string): void {
        this.textInputEl.value = folder;
        this.textInputEl.dispatchEvent(new Event('input'));
        this.close();
    }
}

// ─── Settings tab ────────────────────────────────────────────────

export class ArchiveSearchSettingTab extends PluginSettingTab {
    plugin: TheArchiveSearchPlugin;

    constructor(app: App, plugin: TheArchiveSearchPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ── General (no heading per Obsidian guidelines) ──

        new Setting(containerEl)
            .setName('Intercept wiki-links')
            .setDesc(
                'Clicking [[wiki-links]] triggers an Omnibar search instead of opening the note directly.'
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.interceptWikiLinks)
                    .onChange(async (value) => {
                        this.plugin.settings.interceptWikiLinks = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName('Highlight search matches')
            .setDesc(
                'Highlight matching terms in the editor when browsing search results.'
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.highlightMatches)
                    .onChange(async (value) => {
                        this.plugin.settings.highlightMatches = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName('Show ribbon icon')
            .setDesc('Show the search icon in the left ribbon.')
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.showRibbonIcon)
                    .onChange(async (value) => {
                        this.plugin.settings.showRibbonIcon = value;
                        await this.plugin.saveSettings();
                        this.plugin.updateRibbonIcon();
                    })
            );

        new Setting(containerEl)
            .setName('Omnibar position')
            .setDesc(
                'Which sidebar the Omnibar opens in. Takes effect next time you open it.'
            )
            .addDropdown((drop) =>
                drop
                    .addOption('left', 'Left sidebar')
                    .addOption('right', 'Right sidebar')
                    .setValue(this.plugin.settings.omnibarPosition)
                    .onChange(async (value) => {
                        this.plugin.settings.omnibarPosition = value as
                            | 'left'
                            | 'right';
                        await this.plugin.saveSettings();
                    })
            );

        // ── Search ──

        new Setting(containerEl).setName('Search').setHeading();

        new Setting(containerEl)
            .setName('Sort order')
            .setDesc('How search results are ordered.')
            .addDropdown((drop) => {
                for (const [value, label] of Object.entries(SORT_ORDER_LABELS)) {
                    drop.addOption(value, label);
                }
                drop.setValue(this.plugin.settings.sortOrder).onChange(
                    async (value) => {
                        this.plugin.settings.sortOrder = value as SortOrder;
                        await this.plugin.saveSettings();
                    }
                );
            });

        new Setting(containerEl)
            .setName('Respect Obsidian excluded files')
            .setDesc(
                'Also exclude files matching the patterns in Settings → Files & Links → Excluded files.'
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.respectObsidianExcluded)
                    .onChange(async (value) => {
                        this.plugin.settings.respectObsidianExcluded = value;
                        await this.plugin.saveSettings();
                        await this.plugin.searchEngine.rebuildIndex();
                    })
            );

        // ── Excluded folders (dynamic list) ──

        new Setting(containerEl)
            .setName('Excluded folders')
            .setDesc('Folders to exclude from search results.');

        this.plugin.settings.excludedFolders.forEach((folder, index) => {
            new Setting(containerEl)
                .addSearch((search) => {
                    search
                        .setPlaceholder('Folder path...')
                        .setValue(folder)
                        .onChange(async (value) => {
                            this.plugin.settings.excludedFolders[index] = value;
                            await this.plugin.saveSettings();
                        });
                    new FolderSuggest(this.app, search.inputEl);
                })
                .addExtraButton((btn) =>
                    btn.setIcon('cross').setTooltip('Remove').onClick(async () => {
                        this.plugin.settings.excludedFolders.splice(index, 1);
                        await this.plugin.saveSettings();
                        await this.plugin.searchEngine.rebuildIndex();
                        this.display();
                    })
                );
        });

        new Setting(containerEl).addButton((btn) =>
            btn.setButtonText('Add folder').onClick(async () => {
                this.plugin.settings.excludedFolders.push('');
                await this.plugin.saveSettings();
                this.display();
            })
        );

        // ── Note creation ──

        new Setting(containerEl).setName('Note creation').setHeading();

        new Setting(containerEl)
            .setName('New note folder')
            .setDesc('Folder where new notes are created. Leave empty for vault root.')
            .addSearch((search) => {
                search
                    .setPlaceholder('e.g. Zettelkasten')
                    .setValue(this.plugin.settings.newNotePath)
                    .onChange(async (value) => {
                        this.plugin.settings.newNotePath = value.trim();
                        await this.plugin.saveSettings();
                    });
                new FolderSuggest(this.app, search.inputEl);
            });

        // Date format with live preview
        const dateSampleEl = containerEl.createDiv({
            cls: 'setting-item-description',
        });
        dateSampleEl.style.marginTop = '-8px';
        dateSampleEl.style.marginBottom = '12px';
        dateSampleEl.style.paddingLeft = '18px';

        new Setting(containerEl)
            .setName('Note ID format')
            .setDesc(
                'Moment.js format for the timestamp prefix. Leave empty for no prefix.'
            )
            .addMomentFormat((format) => {
                format
                    .setDefaultFormat('YYYYMMDDHHmm')
                    .setValue(this.plugin.settings.idFormat)
                    .setSampleEl(dateSampleEl)
                    .onChange(async (value) => {
                        this.plugin.settings.idFormat = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('ID separator')
            .setDesc(
                'Character between the ID prefix and the note title. Common: space, dash, underscore.'
            )
            .addText((text) =>
                text
                    .setPlaceholder(' ')
                    .setValue(this.plugin.settings.idSeparator)
                    .onChange(async (value) => {
                        this.plugin.settings.idSeparator = value;
                        await this.plugin.saveSettings();
                    })
            );
    }
}
