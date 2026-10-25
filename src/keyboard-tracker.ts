/**
 * Keyboard tracking for the mobile search surface.
 *
 * Keeps an element exactly as tall as the part of the screen the soft
 * keyboard leaves visible. Two signals are combined (see
 * docs/research/obsidian-mobile-keyboard.md):
 * - Obsidian's `--keyboard-height` CSS variable and its
 *   `keyboardWillShow` / `keyboardWillHide` window events
 * - the visual viewport (height and top offset)
 *
 * Visible height = min(layout height - Obsidian keyboard height, visual
 * viewport height), so a source that is stale or missing can never make
 * the surface taller than what is really visible.
 *
 * iOS only reports the final viewport after the keyboard animation ends, so
 * focusing a text field applies the last measured keyboard height as a
 * guess, and the real measurement corrects it when it arrives. Until then,
 * readings that still say "closed" are stale and do not undo the guess; if no
 * open reading arrives within `GUESS_HOLD_MS` (a hardware keyboard, say), the
 * next measurement is trusted again.
 *
 * Written on the element:
 * - `--mobile-search-visible-height`, `--mobile-search-keyboard-height`,
 *   `--mobile-search-top` (visual viewport offset), `--mobile-search-safe-bottom`
 *   (0 while the keyboard is open, the home indicator inset otherwise)
 * - the `is-keyboard-open` class
 */

/** Keyboard heights at or below this are not a keyboard (browser chrome, etc.). */
export const KEYBOARD_OPEN_THRESHOLD = 120;

/** How long a guessed-open keyboard outlasts readings that still say closed (ms). */
export const GUESS_HOLD_MS = 800;

export const KEYBOARD_STORAGE_KEY = 'the-archive-search-keyboard-height';

const OPEN_CLASS = 'is-keyboard-open';
/** Obsidian's own home-indicator inset (it wraps env(safe-area-inset-bottom)). */
const SAFE_BOTTOM = 'var(--safe-area-inset-bottom, 0px)';
const NON_TEXT_INPUT_TYPES = ['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'image', 'color'];

export interface KeyboardElement {
    style: { setProperty(name: string, value: string): void };
    classList: { toggle(token: string, force?: boolean): boolean };
}

export interface KeyboardEnv {
    readonly innerWidth: number;
    readonly innerHeight: number;
    readonly scrollY: number;
    readonly visualViewport: {
        readonly height: number;
        readonly offsetTop: number;
        addEventListener(type: string, listener: () => void): void;
        removeEventListener(type: string, listener: () => void): void;
    } | null;
    readonly document: {
        readonly activeElement: Element | null;
        readonly documentElement: Element;
        addEventListener(type: string, listener: (event: any) => void): void;
        removeEventListener(type: string, listener: (event: any) => void): void;
    };
    readonly localStorage: Pick<Storage, 'getItem' | 'setItem'>;
    getComputedStyle(element: Element): { getPropertyValue(name: string): string };
    scrollTo(x: number, y: number): void;
    addEventListener(type: string, listener: (event: any) => void): void;
    removeEventListener(type: string, listener: (event: any) => void): void;
    setTimeout(handler: () => void, ms: number): number;
    clearTimeout(id: number | undefined): void;
}

function isTextField(element: Element | null): boolean {
    if (!element) return false;
    const tag = element.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') return !NON_TEXT_INPUT_TYPES.includes((element as HTMLInputElement).type);
    return (element as HTMLElement).isContentEditable === true;
}

/**
 * Track the soft keyboard and size `element` to the visible area.
 * Returns a cleanup function that removes every listener.
 */
export function trackKeyboard(element: KeyboardElement, env: KeyboardEnv = window): () => void {
    const vv = env.visualViewport;
    const doc = env.document;

    let baseline = env.innerHeight;
    let width = env.innerWidth;
    let open = false;
    /** Set while a guessed-open keyboard waits for the measurement to catch up. */
    let holdTimer: number | undefined;

    const endHold = () => {
        env.clearTimeout(holdTimer);
        holdTimer = undefined;
    };

    const storageKey = () => `${KEYBOARD_STORAGE_KEY}-${width > baseline ? 'landscape' : 'portrait'}`;
    const lastKeyboardHeight = () => Number(env.localStorage.getItem(storageKey())) || 0;

    const obsidianKeyboardHeight = () =>
        parseFloat(env.getComputedStyle(doc.documentElement).getPropertyValue('--keyboard-height')) || 0;

    const offsetTop = () => (vv ? Math.round(vv.offsetTop) : 0);

    const apply = (keyboardHeight: number, isOpen: boolean) => {
        open = isOpen;
        element.style.setProperty('--mobile-search-visible-height', `${baseline - keyboardHeight}px`);
        element.style.setProperty('--mobile-search-keyboard-height', `${keyboardHeight}px`);
        element.style.setProperty('--mobile-search-top', `${offsetTop()}px`);
        element.style.setProperty('--mobile-search-safe-bottom', isOpen ? '0px' : SAFE_BOTTOM);
        element.classList.toggle(OPEN_CLASS, isOpen);
    };

    const measure = () => {
        const vvHeight = vv ? vv.height : env.innerHeight;
        const focused = isTextField(doc.activeElement);

        if (env.innerWidth !== width) {
            // Rotated: the old full height no longer applies.
            width = env.innerWidth;
            baseline = env.innerHeight;
        } else {
            // While focused the baseline may only grow, so it heals if it was taken from a shrunken window.
            const fullHeight = Math.max(env.innerHeight, vvHeight);
            baseline = focused ? Math.max(baseline, fullHeight) : fullHeight;
        }

        const visible = Math.min(env.innerHeight - obsidianKeyboardHeight(), vvHeight);
        const keyboardHeight = Math.max(0, Math.round(baseline - visible));
        // No focused text field means no keyboard, whatever a stale signal says.
        const isOpen = focused && keyboardHeight > KEYBOARD_OPEN_THRESHOLD;

        // iOS scrolls the page to reveal the focused field; the surface already follows the visual viewport.
        if (env.scrollY !== 0) env.scrollTo(0, 0);

        // Mid-animation the viewport still reads closed; keep the guess.
        if (holdTimer !== undefined && !isOpen) return;
        endHold();
        if (isOpen) env.localStorage.setItem(storageKey(), String(keyboardHeight));
        apply(isOpen ? keyboardHeight : 0, isOpen);
    };

    const guessOpen = (keyboardHeight: number) => {
        if (keyboardHeight <= KEYBOARD_OPEN_THRESHOLD) return;
        apply(keyboardHeight, true);
        endHold();
        holdTimer = env.setTimeout(() => {
            holdTimer = undefined;
            measure();
        }, GUESS_HOLD_MS);
    };

    const close = () => {
        endHold();
        apply(0, false);
    };

    const onFocusIn = (event: { target: Element | null }) => {
        if (open || !isTextField(event.target)) return;
        guessOpen(lastKeyboardHeight());
    };

    const onFocusOut = (event: { relatedTarget?: Element | null }) => {
        if (!open || isTextField(event.relatedTarget ?? null)) return;
        close();
    };

    const onKeyboardWillShow = (event: { keyboardHeight?: number }) => {
        guessOpen(event.keyboardHeight || obsidianKeyboardHeight() || lastKeyboardHeight());
    };

    const onKeyboardWillHide = close;

    vv?.addEventListener('resize', measure);
    vv?.addEventListener('scroll', measure);
    env.addEventListener('resize', measure);
    env.addEventListener('keyboardWillShow', onKeyboardWillShow);
    env.addEventListener('keyboardWillHide', onKeyboardWillHide);
    doc.addEventListener('focusin', onFocusIn);
    doc.addEventListener('focusout', onFocusOut);

    measure();

    return () => {
        endHold();
        vv?.removeEventListener('resize', measure);
        vv?.removeEventListener('scroll', measure);
        env.removeEventListener('resize', measure);
        env.removeEventListener('keyboardWillShow', onKeyboardWillShow);
        env.removeEventListener('keyboardWillHide', onKeyboardWillHide);
        doc.removeEventListener('focusin', onFocusIn);
        doc.removeEventListener('focusout', onFocusOut);
    };
}
