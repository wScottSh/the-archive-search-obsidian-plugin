/**
 * The Archive Search — Obsidian Plugin
 *
 * Replicates The Archive's Omnibar search behavior:
 * boolean queries, wiki-link-as-search, real-time filtering,
 * arrow-key browsing with editor preview, and note creation.
 */

import { Plugin, MarkdownView, WorkspaceLeaf, Platform } from 'obsidian';
import { SearchEngine } from './src/search-engine';
import { OmnibarView, VIEW_TYPE_OMNIBAR } from './src/omnibar-view';
import {
	ArchiveSearchSettings,
	DEFAULT_SETTINGS,
	ArchiveSearchSettingTab,
} from './src/settings';
import { registerWikiLinkDomHandler, createWikiLinkEditorExtension } from './src/wiki-link-handler';
import { SearchSession } from './src/search-session';
import { MobileSearchModal } from './src/mobile-search-modal';
import { searchHighlightField } from './src/editor-highlight';

export default class TheArchiveSearchPlugin extends Plugin {
	settings: ArchiveSearchSettings;
	searchEngine: SearchEngine;
	/** One mobile search session per plugin instance, so history outlives the modal. */
	mobileSession: SearchSession | null = null;
	private ribbonIconEl: HTMLElement | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Initialize search engine
		this.searchEngine = new SearchEngine(this.app, this.settings);

		// Register the Omnibar sidebar view
		this.registerView(VIEW_TYPE_OMNIBAR, (leaf) => new OmnibarView(leaf, this));

		// Register the "Focus Omnibar" command (user assigns hotkey in settings)
		// Priority: selected text > wiki-link at cursor > hashtag at cursor > plain focus
		this.addCommand({
			id: 'focus-omnibar',
			name: 'Focus Omnibar',
			callback: () => {
				const leaf = this.app.workspace.getMostRecentLeaf();
				let searchText = '';

				if (leaf?.view instanceof MarkdownView) {
					const editor = leaf.view.editor;
					const selection = editor.getSelection()?.trim();

					if (selection) {
						searchText = selection;
					} else {
						// Check if cursor is inside a [[wiki-link]]
						const cursor = editor.getCursor();
						const line = editor.getLine(cursor.line);
						const ch = cursor.ch;

						// Scan left for [[
						const beforeCursor = line.substring(0, ch);
						const openIdx = beforeCursor.lastIndexOf('[[');
						if (openIdx !== -1) {
							// Make sure there's no ]] between [[ and cursor
							const between = beforeCursor.substring(openIdx + 2);
							if (!between.includes(']]')) {
								// Scan right for ]]
								const afterCursor = line.substring(ch);
								const closeIdx = afterCursor.indexOf(']]');
								if (closeIdx !== -1) {
									let linkText = line.substring(openIdx + 2, ch + closeIdx);
									// Handle aliased links: [[target|alias]]
									if (linkText.includes('|')) {
										linkText = linkText.split('|')[0];
									}
									searchText = linkText.trim();
								}
							}
						}

						// If no wiki-link found, check for #hashtag at cursor
						if (!searchText) {
							// Scan left for # (must be preceded by whitespace or at start of line)
							const hashMatch = beforeCursor.match(/(^|\s)#([^\s]*)$/);
							if (hashMatch) {
								const hashStart = beforeCursor.lastIndexOf('#');
								// Scan right for end of tag (whitespace or end of line)
								const afterCursor = line.substring(ch);
								const tagEnd = afterCursor.search(/\s/);
								const fullTag = tagEnd === -1
									? line.substring(hashStart)
									: line.substring(hashStart, ch + tagEnd);
								if (fullTag.length > 1) { // more than just #
									searchText = fullTag;
								}
							}
						}
					}
				}

				this.revealOmnibar(searchText || undefined);
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
		// Mobile: open full-screen modal instead of sidebar
		if (Platform.isMobileApp) {
			new MobileSearchModal(this.app, this, query).open();
			return;
		}

		// Desktop: sidebar Omnibar (unchanged)
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
					// Delay focus: setQuery triggers openFile() which steals
					// focus to the editor. Wait for that + highlights to settle.
					setTimeout(() => view.focusInput(), 150);
				} else {
					view.focusInput();
				}
			}
		}
	}
}
