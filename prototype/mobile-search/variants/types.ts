// PROTOTYPE — contract between the harness and each variant.

import type { SearchSession } from '../session';
import type { Viewport } from '../viewport';

export interface VariantContext {
    session: SearchSession;
    viewport: Viewport;
    /** True when previews (snippets) are enabled — mirrors the showMobilePreviews setting. */
    showPreviews: () => boolean;
}

export interface Variant {
    key: string;
    name: string;
    /**
     * Render into `layer`, which always covers exactly the *visible* area of the screen:
     * top of screen → top of keyboard (or bottom of screen when the keyboard is down).
     * Must focus its search input synchronously (iOS only raises the keyboard for focus()
     * called inside the user's tap). Returns a cleanup function.
     */
    mount(layer: HTMLElement, ctx: VariantContext): () => void;
}
