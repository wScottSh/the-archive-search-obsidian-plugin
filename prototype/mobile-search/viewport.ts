// PROTOTYPE — the one source of truth for "how much screen is left above the keyboard".
//
// sim  — desktop browser: a drawn phone with a drawn keyboard; numbers are exact.
// real — a real phone: window.visualViewport. Works whether the webview resizes for the
//        keyboard (Android adjustResize) or overlays it (iOS): either way vv.height is the
//        visible part. iOS fires vv resize only *after* the keyboard animation ends, so on
//        focus we *predict* the open state from the last measured keyboard height and let
//        the measurement reconcile — layout moves with the keyboard instead of after it.

export interface ViewportState {
    mode: 'sim' | 'real';
    screenH: number;
    visibleH: number;
    offsetTop: number;
    kb: number;
    open: boolean;
    safeTop: number;
    /** 0 while the keyboard is up (the home indicator is under the keyboard). */
    safeBottom: number;
    source: 'sim' | 'predicted' | 'measured';
}

export class Viewport {
    state: ViewportState;
    private listeners = new Set<() => void>();

    constructor(initial: ViewportState) {
        this.state = initial;
    }

    subscribe(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    set(patch: Partial<ViewportState>): void {
        this.state = { ...this.state, ...patch };
        this.listeners.forEach((fn) => fn());
    }
}

const SIM_SCREEN_H = 844;
const SIM_SAFE_TOP = 47;
const SIM_SAFE_BOTTOM = 34;
export const SIM_KB_H = 336;

export function simViewport(): Viewport {
    return new Viewport({
        mode: 'sim',
        screenH: SIM_SCREEN_H,
        visibleH: SIM_SCREEN_H,
        offsetTop: 0,
        kb: 0,
        open: false,
        safeTop: SIM_SAFE_TOP,
        safeBottom: SIM_SAFE_BOTTOM,
        source: 'sim',
    });
}

export function setSimKeyboard(vp: Viewport, open: boolean): void {
    vp.set({
        open,
        kb: open ? SIM_KB_H : 0,
        visibleH: SIM_SCREEN_H - (open ? SIM_KB_H : 0),
        safeBottom: open ? 0 : SIM_SAFE_BOTTOM,
    });
}

function readSafeArea(): { top: number; bottom: number } {
    const probe = document.createElement('div');
    probe.style.cssText =
        'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const out = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
    probe.remove();
    return out;
}

function isTextField(el: Element | null): boolean {
    return (
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range'].includes(el.type)) ||
        (el instanceof HTMLElement && el.isContentEditable)
    );
}

export function realViewport(): Viewport {
    const vv = window.visualViewport;
    const safe = readSafeArea();
    let baseline = window.innerHeight;
    let lastKb = Number(localStorage.getItem('tas-proto-kb')) || 0;

    const vp = new Viewport({
        mode: 'real',
        screenH: baseline,
        visibleH: baseline,
        offsetTop: 0,
        kb: 0,
        open: false,
        safeTop: safe.top,
        safeBottom: safe.bottom,
        source: 'measured',
    });

    const measure = () => {
        const h = vv ? vv.height : window.innerHeight;
        const top = vv ? vv.offsetTop : 0;
        if (!isTextField(document.activeElement)) baseline = Math.max(window.innerHeight, h);
        const kb = Math.max(0, Math.round(baseline - h));
        const open = kb > 120;
        if (open) {
            lastKb = kb;
            localStorage.setItem('tas-proto-kb', String(kb));
        }
        vp.set({
            screenH: baseline,
            visibleH: Math.round(h),
            offsetTop: Math.round(top),
            kb: open ? kb : 0,
            open,
            safeBottom: open ? 0 : safe.bottom,
            source: 'measured',
        });
        // iOS scrolls the layout viewport to "reveal" the focused input; undo it — the
        // layer already follows the visual viewport.
        if (window.scrollY !== 0) window.scrollTo(0, 0);
    };

    vv?.addEventListener('resize', measure);
    vv?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);

    document.addEventListener('focusin', (e) => {
        if (!isTextField(e.target as Element) || vp.state.open || !lastKb) return;
        vp.set({
            open: true,
            kb: lastKb,
            visibleH: baseline - lastKb,
            safeBottom: 0,
            source: 'predicted',
        });
    });
    document.addEventListener('focusout', () => {
        setTimeout(() => {
            if (isTextField(document.activeElement) || !vp.state.open) return;
            vp.set({ open: false, kb: 0, visibleH: baseline, safeBottom: safe.bottom, source: 'predicted' });
        }, 30);
    });

    measure();
    return vp;
}
