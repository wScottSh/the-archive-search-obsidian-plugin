/**
 * The Archive Search — Obsidian Plugin
 *
 * Replicates The Archive's Omnibar search behavior:
 * boolean queries, wiki-link-as-search, real-time filtering,
 * arrow-key browsing with editor preview, and note creation.
 */

import { Plugin, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { SearchEngine } from './src/search-engine';
import { OmnibarView, VIEW_TYPE_OMNIBAR } from './src/omnibar-view';
import {
	ArchiveSearchSettings,
	DEFAULT_SETTINGS,
	ArchiveSearchSettingTab,
} from './src/settings';
import { registerWikiLinkDomHandler, createWikiLinkEditorExtension } from './src/wiki-link-handler';
import { searchHighlightField } from './src/editor-highlight';

export default class TheArchiveSearchPlugin extends Plugin {
	settings: ArchiveSearchSettings;
	searchEngine: SearchEngine;
	private ribbonIconEl: HTMLElement | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Initialize search engine
		this.searchEngine = new SearchEngine(this.app, this.settings);

		// Register the Omnibar sidebar view
		this.registerView(VIEW_TYPE_OMNIBAR, (leaf) => new OmnibarView(leaf, this));

		// Register the "Focus Omnibar" command (user assigns hotkey in settings)
		// If there's a text selection in the editor, it auto-populates the Omnibar
		this.addCommand({
			id: 'focus-omnibar',
			name: 'Focus Omnibar',
			callback: () => {
				// Grab selection from the most recent editor (if any)
				const leaf = this.app.workspace.getMostRecentLeaf();
				let selection = '';
				if (leaf?.view instanceof MarkdownView) {
					selection = leaf.view.editor.getSelection()?.trim() || '';
				}
				this.revealOmnibar(selection || undefined);
			},
		});

		// Register wiki-link interception — Layer 1: global DOM click (Reading mode)
		registerWikiLinkDomHandler(this);

		// Register settings tab
		this.addSettingTab(new ArchiveSearchSettingTab(this.app, this));

		// Register editor extensions (CodeMirror 6):
		// - Search term highlighting StateField
		// - Wiki-link interception in Live Preview (Layer 2)
		this.registerEditorExtension(searchHighlightField);
		this.registerEditorExtension(createWikiLinkEditorExtension(this));

		// Ribbon icon (conditional)
		this.updateRibbonIcon();

		// Build the search index when the workspace is ready
		this.app.workspace.onLayoutReady(async () => {
			await this.searchEngine.buildIndex();

			// Register vault events for incremental index updates
			const events = this.searchEngine.getEventRefs();
			this.registerEvent(this.app.vault.on('create', events.onCreate));
			this.registerEvent(this.app.vault.on('modify', events.onModify));
			this.registerEvent(this.app.vault.on('delete', events.onDelete));
			this.registerEvent(this.app.vault.on('rename', events.onRename));
		});
	}

	onunload(): void {
		// Views are automatically cleaned up by Obsidian
	}

	async loadSettings(): Promise<void> {
		const loaded = await this.loadData();
		this.settings = {
			...DEFAULT_SETTINGS,
			...loaded,
			// Deep copy arrays to avoid reference issues
			excludedFolders: [...(loaded?.excludedFolders ?? DEFAULT_SETTINGS.excludedFolders)],
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// Update search engine settings reference
		if (this.searchEngine) {
			this.searchEngine.updateSettings(this.settings);
		}
	}

	/**
	 * Add or remove the ribbon icon based on settings.
	 */
	updateRibbonIcon(): void {
		if (this.settings.showRibbonIcon) {
			if (!this.ribbonIconEl) {
				this.ribbonIconEl = this.addRibbonIcon(
					'search',
					'The Archive Search',
					() => {
						this.revealOmnibar();
					}
				);
			}
		} else {
			if (this.ribbonIconEl) {
				this.ribbonIconEl.remove();
				this.ribbonIconEl = null;
			}
		}
	}

	/**
	 * Reveal the Omnibar sidebar and optionally populate it with a query.
	 * This is the central entry point used by the hotkey, ribbon icon,
	 * and wiki-link handler.
	 */
	async revealOmnibar(query?: string): Promise<void> {
		// Find existing Omnibar leaf or create one
		let leaf: WorkspaceLeaf | null = null;

		this.app.workspace.iterateAllLeaves((l) => {
			if (l.view.getViewType() === VIEW_TYPE_OMNIBAR) {
				leaf = l;
			}
		});

		if (!leaf) {
			const sideLeaf =
				this.settings.omnibarPosition === 'left'
					? this.app.workspace.getLeftLeaf(false)
					: this.app.workspace.getRightLeaf(false);
			if (sideLeaf) {
				await sideLeaf.setViewState({
					type: VIEW_TYPE_OMNIBAR,
					active: true,
				});
				leaf = sideLeaf;
			}
		}

		if (leaf) {
			this.app.workspace.revealLeaf(leaf);
			const view = leaf.view;
			if (view instanceof OmnibarView) {
				if (query !== undefined) {
					view.setQuery(query);
				}
				view.focusInput();
			}
		}
	}
}
