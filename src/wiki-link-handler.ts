/**
 * Wiki-link interception handler.
 *
 * Two-layer approach that works in both Reading mode and Live Preview:
 *
 * Layer 1: Global DOM click listener (capture phase) for Reading mode
 *   - Catches clicks on `a.internal-link` elements in rendered markdown
 *   - Uses registerDomEvent on document for automatic cleanup
 *
 * Layer 2: CodeMirror 6 EditorView extension for Live Preview
 *   - Catches clicks on `.cm-hmd-internal-link` spans in the CM6 editor
 *   - Registered as an editor extension alongside the highlight field
 *
 * Both layers call preventDefault + stopPropagation and route to the Omnibar.
 */

import { EditorView } from '@codemirror/view';
import type TheArchiveSearchPlugin from '../main';

/**
 * Extract the link text from a clicked internal link element.
 * Works for both Reading mode (`data-href`) and plain text content.
 */
function getLinkText(el: HTMLElement): string {
    return el.getAttribute('data-href') || el.textContent?.trim() || '';
}

/**
 * Register a global DOM click listener (capture phase) that intercepts
 * internal link clicks in Reading mode and rendered previews.
 *
 * Call this in onload(). Cleanup is automatic via registerDomEvent.
 */
export function registerWikiLinkDomHandler(plugin: TheArchiveSearchPlugin): void {
    plugin.registerDomEvent(
        document,
        'click',
        (evt: MouseEvent) => {
            if (!plugin.settings.interceptWikiLinks) return;

            const target = evt.target as HTMLElement;
            const link = target.closest('a.internal-link') as HTMLElement | null;

            if (link) {
                const linkText = getLinkText(link);
                if (linkText) {
                    evt.preventDefault();
                    evt.stopPropagation();
                    plugin.revealOmnibar(linkText);
                }
            }
        },
        true // capture phase — fires before Obsidian's workspace-level handler
    );
}

/**
 * CodeMirror 6 extension that intercepts internal link clicks in Live Preview.
 *
 * In Live Preview, links are rendered as:
 *   <span class="cm-hmd-internal-link">
 *     <span class="cm-underline">link text</span>
 *   </span>
 *
 * We listen for click events and check if the target is inside one of these
 * spans. The link text is extracted from the span content.
 *
 * NOTE: This is a factory that captures the plugin reference. The returned
 * extension must be registered via registerEditorExtension().
 */
export function createWikiLinkEditorExtension(plugin: TheArchiveSearchPlugin) {
    return EditorView.domEventHandlers({
        click(event: MouseEvent, view: EditorView) {
            if (!plugin.settings.interceptWikiLinks) return false;

            const target = event.target as HTMLElement;

            // Check if we clicked inside a wiki-link in Live Preview
            const linkSpan = target.closest('.cm-hmd-internal-link') as HTMLElement | null;

            if (linkSpan) {
                // Extract the raw link text, stripping the [[ and ]] markers
                let linkText = linkSpan.textContent?.trim() || '';
                // CM6 renders the brackets as part of the span tree — strip them
                linkText = linkText.replace(/^\[\[/, '').replace(/\]\]$/, '');

                // Handle aliased links: [[target|alias]] → search for "target"
                if (linkText.includes('|')) {
                    linkText = linkText.split('|')[0].trim();
                }

                if (linkText) {
                    event.preventDefault();
                    event.stopPropagation();
                    plugin.revealOmnibar(linkText);
                    return true; // signal that we handled the event
                }
            }

            return false;
        },
    });
}
