/**
 * Wiki-link interception handler.
 *
 * When enabled (on by default), intercepts clicks on [[wiki-links]]
 * and redirects them to populate the Omnibar with the link text,
 * triggering a search instead of Obsidian's default open-or-create behavior.
 *
 * This is the core "link-as-search" behavior from The Archive.
 */

import { MarkdownPostProcessorContext } from 'obsidian';
import type TheArchiveSearchPlugin from '../main';

/**
 * Markdown post-processor that intercepts internal link clicks.
 * Must be registered via plugin.registerMarkdownPostProcessor().
 */
export function createWikiLinkProcessor(plugin: TheArchiveSearchPlugin) {
    return (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        // Only process if interception is enabled
        if (!plugin.settings.interceptWikiLinks) return;

        const links = el.querySelectorAll('a.internal-link');
        links.forEach((linkEl) => {
            const link = linkEl as HTMLAnchorElement;

            // Store the original href/data
            const linkText = link.getAttribute('data-href') || link.textContent || '';

            // Replace the click handler
            link.addEventListener('click', (e: MouseEvent) => {
                // Only intercept if the setting is still enabled
                if (!plugin.settings.interceptWikiLinks) return;

                e.preventDefault();
                e.stopPropagation();

                // Reveal the Omnibar and populate it with the link text
                plugin.revealOmnibar(linkText);
            }, true); // Use capture phase to beat Obsidian's handler
        });
    };
}
