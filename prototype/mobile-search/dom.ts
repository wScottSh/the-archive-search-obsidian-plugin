// PROTOTYPE — polyfills Obsidian's HTMLElement helpers (createDiv, createEl, empty, toggleClass…)
export {};
// so variant code reads exactly like plugin code and ports over without translation.

type Opts = {
    cls?: string | string[];
    text?: string;
    attr?: Record<string, string | number | boolean | null>;
    type?: string;
    placeholder?: string;
    value?: string;
};

function apply(el: HTMLElement, o?: Opts | string): void {
    if (!o) return;
    if (typeof o === 'string') {
        el.className = o;
        return;
    }
    if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
    if (o.text !== undefined) el.textContent = o.text;
    if (o.type) el.setAttribute('type', o.type);
    if (o.placeholder) el.setAttribute('placeholder', o.placeholder);
    if (o.value !== undefined) (el as HTMLInputElement).value = o.value;
    if (o.attr) {
        for (const [k, v] of Object.entries(o.attr)) {
            if (v === null || v === false) el.removeAttribute(k);
            else el.setAttribute(k, String(v));
        }
    }
}

const P = HTMLElement.prototype as any;

P.createEl = function (tag: string, o?: Opts | string, cb?: (el: HTMLElement) => void) {
    const el = document.createElement(tag);
    apply(el, o);
    this.appendChild(el);
    cb?.(el);
    return el;
};
P.createDiv = function (o?: Opts | string, cb?: (el: HTMLElement) => void) {
    return this.createEl('div', o, cb);
};
P.createSpan = function (o?: Opts | string, cb?: (el: HTMLElement) => void) {
    return this.createEl('span', o, cb);
};
P.empty = function () {
    while (this.firstChild) this.removeChild(this.firstChild);
};
P.addClass = function (...c: string[]) {
    this.classList.add(...c);
};
P.removeClass = function (...c: string[]) {
    this.classList.remove(...c);
};
P.toggleClass = function (c: string, v: boolean) {
    this.classList.toggle(c, v);
};
P.hasClass = function (c: string) {
    return this.classList.contains(c);
};
P.setText = function (t: string) {
    this.textContent = t;
};
P.setAttr = function (k: string, v: string | number | boolean | null) {
    if (v === null || v === false) this.removeAttribute(k);
    else this.setAttribute(k, String(v));
};
P.appendText = function (t: string) {
    this.appendChild(document.createTextNode(t));
};
