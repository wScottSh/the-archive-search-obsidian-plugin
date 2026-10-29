/** Obsidian's HTMLElement helpers (createDiv, createEl, empty, toggleClass...). */

type Options = {
    cls?: string | string[];
    text?: string;
    attr?: Record<string, string | number | boolean | null>;
    type?: string;
    placeholder?: string;
    value?: string;
};

function apply(el: HTMLElement, options?: Options | string): void {
    if (!options) return;
    if (typeof options === 'string') {
        el.className = options;
        return;
    }
    if (options.cls) el.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
    if (options.text !== undefined) el.textContent = options.text;
    if (options.type) el.setAttribute('type', options.type);
    if (options.placeholder) el.setAttribute('placeholder', options.placeholder);
    if (options.value !== undefined) (el as HTMLInputElement).value = options.value;
    if (options.attr) {
        for (const [key, value] of Object.entries(options.attr)) {
            if (value === null || value === false) el.removeAttribute(key);
            else el.setAttribute(key, String(value));
        }
    }
}

const proto = HTMLElement.prototype as any;

proto.createEl = function (tag: string, options?: Options | string, callback?: (el: HTMLElement) => void) {
    const el = document.createElement(tag);
    apply(el, options);
    this.appendChild(el);
    callback?.(el);
    return el;
};
proto.createDiv = function (options?: Options | string, callback?: (el: HTMLElement) => void) {
    return this.createEl('div', options, callback);
};
proto.createSpan = function (options?: Options | string, callback?: (el: HTMLElement) => void) {
    return this.createEl('span', options, callback);
};
proto.empty = function () {
    while (this.firstChild) this.removeChild(this.firstChild);
};
proto.addClass = function (...classes: string[]) {
    this.classList.add(...classes);
};
proto.removeClass = function (...classes: string[]) {
    this.classList.remove(...classes);
};
proto.toggleClass = function (cls: string, value: boolean) {
    this.classList.toggle(cls, value);
};
proto.hasClass = function (cls: string) {
    return this.classList.contains(cls);
};
proto.setText = function (text: string) {
    this.textContent = text;
};
proto.setAttr = function (key: string, value: string | number | boolean | null) {
    if (value === null || value === false) this.removeAttribute(key);
    else this.setAttribute(key, String(value));
};
proto.appendText = function (text: string) {
    this.appendChild(document.createTextNode(text));
};

export {};
