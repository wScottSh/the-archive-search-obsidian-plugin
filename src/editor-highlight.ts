/**
 * Editor search highlighter.
 *
 * Finds all occurrences of the search terms in the currently open editor,
 * highlights them with CSS marks, and scrolls to the first match.
 *
 * Uses CodeMirror 6's StateEffect + Decoration system via Obsidian's
 * registerEditorExtension API for proper integration.
 */

import { EditorView, Decoration, DecorationSet } from '@codemirror/view';
import { StateEffect, StateField, RangeSetBuilder } from '@codemirror/state';
import { SearchNode } from './parser';

// ─── State Effect for updating highlights ────────────────────────

/** Effect to set the current search terms to highlight */
export const setSearchHighlights = StateEffect.define<string[]>();

/** Effect to clear all search highlights */
export const clearSearchHighlights = StateEffect.define<null>();

// ─── Decoration mark ─────────────────────────────────────────────

const highlightMark = Decoration.mark({ class: 'the-archive-search-highlight' });

// ─── StateField that manages highlight decorations ───────────────

export const searchHighlightField = StateField.define<DecorationSet>({
    create() {
        return Decoration.none;
    },
    update(decorations, tr) {
        for (const effect of tr.effects) {
            if (effect.is(clearSearchHighlights)) {
                return Decoration.none;
            }
            if (effect.is(setSearchHighlights)) {
                const terms = effect.value;
                if (terms.length === 0) {
                    return Decoration.none;
                }
                // Build decorations for all matches
                const builder = new RangeSetBuilder<Decoration>();
                const doc = tr.state.doc;
                const text = doc.toString().toLowerCase();

                // Collect all match ranges
                const ranges: { from: number; to: number }[] = [];
                for (const term of terms) {
                    const termLower = term.toLowerCase();
                    if (!termLower) continue;
                    let pos = 0;
                    while ((pos = text.indexOf(termLower, pos)) !== -1) {
                        ranges.push({ from: pos, to: pos + termLower.length });
                        pos += termLower.length;
                    }
                }

                // Sort by position (required by RangeSetBuilder)
                ranges.sort((a, b) => a.from - b.from || a.to - b.to);

                // Remove overlapping ranges
                const merged: { from: number; to: number }[] = [];
                for (const r of ranges) {
                    if (merged.length === 0 || r.from >= merged[merged.length - 1].to) {
                        merged.push({ ...r });
                    } else {
                        merged[merged.length - 1].to = Math.max(merged[merged.length - 1].to, r.to);
                    }
                }

                for (const r of merged) {
                    builder.add(r.from, r.to, highlightMark);
                }

                return builder.finish();
            }
        }
        // Map existing decorations through document changes
        return decorations.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
});

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Extract the raw search terms (words and phrases) from a parsed AST.
 * Traverses the tree and collects all WORD and PHRASE values,
 * skipping NOT branches (we don't highlight excluded terms).
 */
export function extractSearchTerms(node: SearchNode | null): string[] {
    if (!node) return [];

    switch (node.type) {
        case 'WORD':
            return [node.value];
        case 'PHRASE':
            return [node.value];
        case 'AND':
            return [...extractSearchTerms(node.left), ...extractSearchTerms(node.right)];
        case 'OR':
            return [...extractSearchTerms(node.left), ...extractSearchTerms(node.right)];
        case 'NOT':
            // Don't highlight negated terms
            return [];
    }
}

/**
 * Apply search highlights to an EditorView and scroll to the first match.
 */
export function highlightInEditor(view: EditorView, terms: string[]): void {
    if (terms.length === 0) {
        view.dispatch({ effects: clearSearchHighlights.of(null) });
        return;
    }

    view.dispatch({ effects: setSearchHighlights.of(terms) });

    // Scroll to first match
    const text = view.state.doc.toString().toLowerCase();
    let firstPos = Infinity;
    for (const term of terms) {
        const termLower = term.toLowerCase();
        if (!termLower) continue;
        const pos = text.indexOf(termLower);
        if (pos !== -1 && pos < firstPos) {
            firstPos = pos;
        }
    }

    if (firstPos !== Infinity) {
        view.dispatch({
            effects: EditorView.scrollIntoView(firstPos, { y: 'center' }),
        });
    }
}

/**
 * Clear all search highlights from an EditorView.
 */
export function clearHighlightsInEditor(view: EditorView): void {
    view.dispatch({ effects: clearSearchHighlights.of(null) });
}
