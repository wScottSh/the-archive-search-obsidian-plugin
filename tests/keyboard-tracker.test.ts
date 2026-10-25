import { describe, it, expect, beforeEach } from 'vitest';
import {
    trackKeyboard,
    KEYBOARD_OPEN_THRESHOLD,
    KEYBOARD_STORAGE_KEY,
    GUESS_HOLD_MS,
    KeyboardEnv,
} from '../src/keyboard-tracker';

type Listener = (event: any) => void;

class FakeTarget {
    private listeners = new Map<string, Set<Listener>>();
    addEventListener(type: string, fn: Listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(fn);
    }
    removeEventListener(type: string, fn: Listener) {
        this.listeners.get(type)?.delete(fn);
    }
    dispatch(type: string, event: object = {}) {
        this.listeners.get(type)?.forEach((fn) => fn(event));
    }
    count(type: string) {
        return this.listeners.get(type)?.size ?? 0;
    }
}

const input = { tagName: 'INPUT', type: 'text' } as unknown as Element;
const button = { tagName: 'BUTTON' } as unknown as Element;

/** A phone: a window, a visual viewport, a document with focus, storage and Obsidian's CSS variable. */
class FakePhone extends FakeTarget {
    innerWidth = 390;
    innerHeight = 800;
    scrollY = 0;
    scrolledTo: Array<[number, number]> = [];
    obsidianKeyboardHeight = '';
    storage = new Map<string, string>();
    visualViewport = Object.assign(new FakeTarget(), { height: 800, offsetTop: 0 });
    document = Object.assign(new FakeTarget(), {
        activeElement: null as Element | null,
        documentElement: {} as Element,
    });
    localStorage = {
        getItem: (key: string) => this.storage.get(key) ?? null,
        setItem: (key: string, value: string) => void this.storage.set(key, value),
    };

    getComputedStyle = () => ({
        getPropertyValue: (name: string) => (name === '--keyboard-height' ? this.obsidianKeyboardHeight : ''),
    });
    scrollTo = (x: number, y: number) => void this.scrolledTo.push([x, y]);

    private timers = new Map<number, { at: number; fn: () => void }>();
    private nextTimer = 1;
    private now = 0;
    setTimeout = (fn: () => void, ms: number) => {
        const id = this.nextTimer++;
        this.timers.set(id, { at: this.now + ms, fn });
        return id;
    };
    clearTimeout = (id: number | undefined) => void (id !== undefined && this.timers.delete(id));
    /** Let `ms` of time pass, running any timers that come due. */
    advance(ms: number) {
        this.now += ms;
        for (const [id, timer] of [...this.timers]) {
            if (timer.at > this.now) continue;
            this.timers.delete(id);
            timer.fn();
        }
    }
    get pendingTimers() { return this.timers.size; }

    focus(element: Element | null) {
        const previous = this.document.activeElement;
        if (previous) this.document.dispatch('focusout', { target: previous, relatedTarget: element });
        this.document.activeElement = element;
        if (element) this.document.dispatch('focusin', { target: element });
    }

    /** The keyboard finishes opening: the visual viewport shrinks. */
    keyboardSettles(height: number) {
        this.visualViewport.height = this.innerHeight - height;
        this.visualViewport.dispatch('resize');
    }

    asEnv(): KeyboardEnv {
        return this as unknown as KeyboardEnv;
    }
}

class FakeElement {
    props = new Map<string, string>();
    classes = new Set<string>();
    style = { setProperty: (name: string, value: string) => void this.props.set(name, value) };
    classList = {
        toggle: (token: string, force?: boolean) => {
            const on = force ?? !this.classes.has(token);
            if (on) this.classes.add(token);
            else this.classes.delete(token);
            return on;
        },
    };
    get visible() { return this.props.get('--mobile-search-visible-height'); }
    get keyboard() { return this.props.get('--mobile-search-keyboard-height'); }
    get top() { return this.props.get('--mobile-search-top'); }
    get safeBottom() { return this.props.get('--mobile-search-safe-bottom'); }
    get isOpen() { return this.classes.has('is-keyboard-open'); }
}

const STORED = `${KEYBOARD_STORAGE_KEY}-portrait`;

describe('trackKeyboard', () => {
    let phone: FakePhone;
    let el: FakeElement;

    beforeEach(() => {
        phone = new FakePhone();
        el = new FakeElement();
    });

    it('starts closed at full height with the home indicator inset', () => {
        trackKeyboard(el, phone.asEnv());
        expect(el.visible).toBe('800px');
        expect(el.keyboard).toBe('0px');
        expect(el.isOpen).toBe(false);
        expect(el.safeBottom).toContain('safe-area-inset-bottom');
    });

    it('guesses open from the stored height on focus, before any measurement', () => {
        phone.storage.set(STORED, '336');
        trackKeyboard(el, phone.asEnv());
        phone.focus(input);
        expect(el.isOpen).toBe(true);
        expect(el.keyboard).toBe('336px');
        expect(el.visible).toBe('464px');
    });

    it('does not guess without a stored height', () => {
        trackKeyboard(el, phone.asEnv());
        phone.focus(input);
        expect(el.isOpen).toBe(false);
        expect(el.visible).toBe('800px');
    });

    it('ignores focus on non-text elements', () => {
        phone.storage.set(STORED, '336');
        trackKeyboard(el, phone.asEnv());
        phone.focus(button);
        expect(el.isOpen).toBe(false);
    });

    it('corrects the guess when the real measurement arrives, and stores it', () => {
        phone.storage.set(STORED, '300');
        trackKeyboard(el, phone.asEnv());
        phone.focus(input);
        expect(el.keyboard).toBe('300px');
        phone.keyboardSettles(340);
        expect(el.keyboard).toBe('340px');
        expect(el.visible).toBe('460px');
        expect(phone.storage.get(STORED)).toBe('340');
    });

    it('a stale closed reading during the keyboard animation does not undo the guess', () => {
        phone.storage.set(STORED, '300');
        trackKeyboard(el, phone.asEnv());
        phone.focus(input);
        // iOS: the viewport has not shrunk yet, but something fires a measurement
        phone.visualViewport.dispatch('scroll');
        expect(el.isOpen).toBe(true);
        expect(el.keyboard).toBe('300px');
        phone.keyboardSettles(340);
        expect(el.keyboard).toBe('340px');
        expect(phone.pendingTimers).toBe(0);
    });

    it('a guess that no measurement confirms is dropped after the hold', () => {
        phone.storage.set(STORED, '300');
        trackKeyboard(el, phone.asEnv());
        // A hardware keyboard: focus, but the viewport never shrinks
        phone.focus(input);
        phone.advance(GUESS_HOLD_MS - 1);
        expect(el.isOpen).toBe(true);
        phone.advance(1);
        expect(el.isOpen).toBe(false);
        expect(el.visible).toBe('800px');
    });

    it('blur during the hold closes at once and cancels the hold', () => {
        phone.storage.set(STORED, '300');
        trackKeyboard(el, phone.asEnv());
        phone.focus(input);
        phone.focus(null);
        expect(el.isOpen).toBe(false);
        expect(phone.pendingTimers).toBe(0);
    });

    it('first-ever open is taken from the measurement alone', () => {
        trackKeyboard(el, phone.asEnv());
        phone.focus(input);
        phone.keyboardSettles(336);
        expect(el.isOpen).toBe(true);
        expect(el.visible).toBe('464px');
        expect(phone.storage.get(STORED)).toBe('336');
    });

    it('guesses closed on blur, then the measurement agrees', () => {
        trackKeyboard(el, phone.asEnv());
        phone.focus(input);
        phone.keyboardSettles(336);
        phone.focus(null);
        expect(el.isOpen).toBe(false);
        expect(el.visible).toBe('800px');
        expect(el.keyboard).toBe('0px');
        phone.keyboardSettles(0);
        expect(el.isOpen).toBe(false);
        expect(el.visible).toBe('800px');
    });

    it('stays open when focus moves to another text field', () => {
        trackKeyboard(el, phone.asEnv());
        phone.focus(input);
        phone.keyboardSettles(336);
        phone.focus({ tagName: 'TEXTAREA' } as unknown as Element);
        expect(el.isOpen).toBe(true);
    });

    it('does not call a keyboard at or below the threshold open', () => {
        trackKeyboard(el, phone.asEnv());
        phone.focus(input);
        phone.keyboardSettles(KEYBOARD_OPEN_THRESHOLD);
        expect(el.isOpen).toBe(false);
        expect(el.keyboard).toBe('0px');
        phone.keyboardSettles(KEYBOARD_OPEN_THRESHOLD + 1);
        expect(el.isOpen).toBe(true);
        expect(el.keyboard).toBe(`${KEYBOARD_OPEN_THRESHOLD + 1}px`);
    });

    it('sets the bottom safe area to 0 while open and restores it when closed', () => {
        trackKeyboard(el, phone.asEnv());
        phone.focus(input);
        phone.keyboardSettles(336);
        expect(el.safeBottom).toBe('0px');
        phone.focus(null);
        expect(el.safeBottom).toContain('safe-area-inset-bottom');
    });

    it('rotation resets the baseline even while a field is focused', () => {
        trackKeyboard(el, phone.asEnv());
        phone.focus(input);
        phone.keyboardSettles(336);
        phone.innerWidth = 800;
        phone.innerHeight = 390;
        phone.visualViewport.height = 390 - 200;
        phone.dispatch('resize');
        expect(el.keyboard).toBe('200px');
        expect(el.visible).toBe('190px');
        expect(phone.storage.get(`${KEYBOARD_STORAGE_KEY}-landscape`)).toBe('200');
        expect(phone.storage.get(STORED)).toBe('336');
    });

    it('a window that only gets shorter while focused never leaves the surface taller than visible', () => {
        trackKeyboard(el, phone.asEnv());
        phone.focus(input);
        // Split screen, say: same width, 100px shorter, no soft keyboard
        phone.innerHeight = 700;
        phone.visualViewport.height = 700;
        phone.dispatch('resize');
        expect(el.isOpen).toBe(false);
        expect(el.visible).toBe('700px');
    });

    it('follows the visual viewport top offset and undoes the iOS page scroll', () => {
        trackKeyboard(el, phone.asEnv());
        phone.focus(input);
        phone.scrollY = 120;
        phone.visualViewport.height = 464;
        phone.visualViewport.offsetTop = 120;
        phone.visualViewport.dispatch('scroll');
        expect(el.top).toBe('120px');
        expect(phone.scrolledTo).toEqual([[0, 0]]);
    });

    it('uses the smaller of the Obsidian signal and the visual viewport', () => {
        trackKeyboard(el, phone.asEnv());
        phone.focus(input);
        // Overlay: Obsidian knows the keyboard, the visual viewport has not caught up.
        phone.obsidianKeyboardHeight = '336px';
        phone.visualViewport.dispatch('resize');
        expect(el.visible).toBe('464px');
        // Variable missing: the visual viewport alone is enough.
        phone.obsidianKeyboardHeight = '0px';
        phone.keyboardSettles(300);
        expect(el.visible).toBe('500px');
    });

    it('keyboardWillShow applies the event height ahead of the measurement', () => {
        trackKeyboard(el, phone.asEnv());
        phone.dispatch('keyboardWillShow', { keyboardHeight: 320 });
        expect(el.isOpen).toBe(true);
        expect(el.visible).toBe('480px');
    });

    it('keyboardWillShow falls back to Obsidian\'s variable, then the stored height', () => {
        trackKeyboard(el, phone.asEnv());
        phone.obsidianKeyboardHeight = '310px';
        phone.dispatch('keyboardWillShow', {});
        expect(el.keyboard).toBe('310px');
        phone.obsidianKeyboardHeight = '';
        phone.dispatch('keyboardWillHide');
        phone.storage.set(STORED, '290');
        phone.dispatch('keyboardWillShow', {});
        expect(el.keyboard).toBe('290px');
    });

    it('keyboardWillHide closes ahead of the measurement', () => {
        trackKeyboard(el, phone.asEnv());
        phone.focus(input);
        phone.keyboardSettles(336);
        phone.dispatch('keyboardWillHide');
        expect(el.isOpen).toBe(false);
        expect(el.visible).toBe('800px');
    });

    it('a stale signal cannot reopen the keyboard once no field is focused', () => {
        trackKeyboard(el, phone.asEnv());
        phone.focus(input);
        phone.keyboardSettles(336);
        phone.focus(null);
        phone.visualViewport.dispatch('scroll');
        expect(el.isOpen).toBe(false);
        expect(el.visible).toBe('800px');
    });

    it('cleanup removes every listener', () => {
        phone.storage.set(STORED, '300');
        const stop = trackKeyboard(el, phone.asEnv());
        phone.focus(input);
        stop();
        expect(phone.pendingTimers).toBe(0);
        expect(phone.count('resize')).toBe(0);
        expect(phone.count('keyboardWillShow')).toBe(0);
        expect(phone.count('keyboardWillHide')).toBe(0);
        expect(phone.visualViewport.count('resize')).toBe(0);
        expect(phone.visualViewport.count('scroll')).toBe(0);
        expect(phone.document.count('focusin')).toBe(0);
        expect(phone.document.count('focusout')).toBe(0);
    });

    it('works without a visual viewport', () => {
        phone.visualViewport = null as never;
        trackKeyboard(el, phone.asEnv());
        phone.innerHeight = 464;
        phone.focus(input);
        phone.dispatch('resize');
        expect(el.top).toBe('0px');
        expect(el.visible).toBe('464px');
    });
});
