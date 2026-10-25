// PROTOTYPE — harness for mobile search UI variants. Throwaway; lives on branch prototype/mobile-search-ui.
//
// Question: what should the mobile search UI look like so it is beautiful, has full desktop
// parity, and handles the keyboard taking half the screen?
// Plan: three structurally different variants on one page, switchable via ?variant=, running
// against the plugin's real SearchEngine + parser over a fake in-memory vault.
//
// Desktop browser → drawn phone + drawn keyboard (?mode=sim). Real phone → real keyboard (?mode=real).

import './dom';
import './styles/harness.css';
import { App, TFile } from 'obsidian';
import { SearchEngine } from '../../src/search-engine';
import type { ArchiveSearchSettings, SortOrder } from '../../src/settings';
import { NOTES } from './vault';
import { setIcon } from './icons';
import { SearchSession, Host, FileAction, highlight } from './session';
import { Viewport, simViewport, realViewport, setSimKeyboard } from './viewport';
import { VARIANTS } from './variants';
import type { Variant } from './variants/types';

// ── Fake vault + real engine ─────────────────────────────────────

// The shim's TFile takes (path, ctime, mtime); tsc sees the real obsidian typings.
const newFile = (path: string, ctime: number, mtime: number): TFile =>
    new (TFile as unknown as new (p: string, c: number, m: number) => TFile)(path, ctime, mtime);

const files = new Map<string, TFile>();
const contents = new Map<TFile, string>();
for (const n of NOTES) {
    const f = newFile(n.path, n.ctime, n.mtime);
    files.set(n.path, f);
    contents.set(f, n.content);
}

const settings: ArchiveSearchSettings = {
    interceptWikiLinks: true,
    highlightMatches: true,
    sortOrder: 'a-z',
    omnibarPosition: 'right',
    showRibbonIcon: true,
    respectObsidianExcluded: true,
    showMobilePreviews: true,
    excludedFolders: [],
    newNoteLocation: 'vault-root',
    newNoteFolder: '',
};

const app = Object.assign(new App(), {
    vault: {
        getMarkdownFiles: () => [...contents.keys()],
        cachedRead: async (f: TFile) => contents.get(f) ?? '',
        config: {},
    },
}) as any;
const engine = new SearchEngine(app, settings);

// ── Mode + DOM skeleton ──────────────────────────────────────────

const params = new URLSearchParams(location.search);
const forced = params.get('mode');
const mode: 'sim' | 'real' =
    forced === 'sim' || forced === 'real'
        ? forced
        : matchMedia('(pointer: coarse)').matches && innerWidth < 820
            ? 'real'
            : 'sim';

document.body.addClass('proto', `proto-${mode}`);
const stage = document.body.createDiv('proto-stage');
const phone = stage.createDiv('proto-phone');
const screen = phone.createDiv('proto-screen theme-dark is-mobile');
const workspaceEl = screen.createDiv('proto-workspace');
const layer = screen.createDiv('proto-layer');
const toastEl = screen.createDiv('proto-toast');
let keyboardEl: HTMLElement | null = null;
if (mode === 'sim') {
    const status = screen.createDiv('proto-statusbar');
    status.createSpan({ cls: 'proto-time', text: '9:41' });
    status.createDiv('proto-island');
    status.createSpan({ cls: 'proto-signal', text: '●●● 5G ▮' });
    screen.createDiv('proto-home-indicator');
    keyboardEl = screen.createDiv('proto-keyboard');
}

const viewport: Viewport = mode === 'sim' ? simViewport() : realViewport();

// ── Fake Obsidian workspace (the editor behind search) ───────────

let currentFile: TFile = files.get('Projects/Archive Search plugin/Mobile redesign.md')!;
let editorTerms: string[] = [];
let caretAtFirstHit = false;
const fileHistory: TFile[] = [currentFile];
let fileHistoryPos = 0;

const header = workspaceEl.createDiv('proto-view-header');
const headerBack = header.createDiv('proto-icon-btn');
setIcon(headerBack, 'chevron-left');
const headerTitle = header.createDiv('proto-view-title');
const headerMore = header.createDiv('proto-icon-btn');
setIcon(headerMore, 'more-vertical');
const editorEl = workspaceEl.createDiv('proto-editor markdown-rendered');
const navbar = workspaceEl.createDiv('proto-navbar');
const navItems: [string, string, () => void][] = [
    ['arrow-left', 'Back', () => moveHistory(-1)],
    ['arrow-right', 'Forward', () => moveHistory(1)],
    ['plus', 'New note', () => toast('New note (stub)')],
    ['search', 'The Archive Search', () => openSearch()],
    ['menu', 'Menu', () => toast('Menu (stub)')],
];
for (const [icon, label, fn] of navItems) {
    const b = navbar.createDiv({ cls: 'proto-navbar-btn', attr: { 'aria-label': label } });
    if (icon === 'search') b.addClass('is-plugin');
    setIcon(b, icon);
    b.addEventListener('click', fn);
}
headerBack.addEventListener('click', () => moveHistory(-1));

function moveHistory(d: number): void {
    const next = fileHistoryPos + d;
    if (next < 0 || next >= fileHistory.length) return;
    fileHistoryPos = next;
    showFile(fileHistory[next], [], false, false);
}

function showFile(file: TFile, terms: string[], caret: boolean, record = true): void {
    if (record && file !== currentFile) {
        fileHistory.splice(fileHistoryPos + 1);
        fileHistory.push(file);
        fileHistoryPos = fileHistory.length - 1;
    }
    currentFile = file;
    editorTerms = settings.highlightMatches ? terms : [];
    caretAtFirstHit = caret;
    renderEditor();
}

function renderEditor(): void {
    headerTitle.setText(currentFile.basename);
    editorEl.empty();
    const md = contents.get(currentFile) ?? '';
    let ul: HTMLElement | null = null;
    let first: HTMLElement | null = null;
    for (const line of md.split('\n')) {
        if (!line.trim()) {
            ul = null;
            continue;
        }
        let el: HTMLElement;
        const h = line.match(/^(#{1,3}) (.*)$/);
        const li = line.match(/^\s*(?:[-*]|\d+\.) (.*)$/);
        if (h) {
            ul = null;
            el = editorEl.createEl(`h${h[1].length}` as 'h1');
            inline(el, h[2]);
        } else if (li) {
            ul = ul ?? editorEl.createEl('ul');
            el = ul.createEl('li');
            inline(el, li[1]);
        } else {
            ul = null;
            el = editorEl.createEl('p');
            inline(el, line);
        }
        first = first ?? el.querySelector('mark');
    }
    if (first) {
        if (caretAtFirstHit) first.insertAdjacentElement('beforebegin', createCaret());
        // Manual scroll: scrollIntoView also scrolls overflow:hidden ancestors (shifts the whole screen).
        requestAnimationFrame(() => {
            if (!first) return;
            const top = first.getBoundingClientRect().top - editorEl.getBoundingClientRect().top;
            editorEl.scrollTop += top - editorEl.clientHeight / 3;
        });
    } else {
        editorEl.scrollTop = 0;
    }
}

function createCaret(): HTMLElement {
    const c = document.createElement('span');
    c.className = 'proto-caret';
    return c;
}

/** Minimal inline markdown: [[links]], #tags, **bold**, *em*, `code`, with search highlights. */
function inline(el: HTMLElement, text: string): void {
    const re = /(\[\[[^\]]+\]\]|(?:^|(?<=\s))#[\w/-]+|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
    let last = 0;
    for (const m of text.matchAll(re)) {
        const idx = m.index ?? 0;
        if (idx > last) marked(el, text.substring(last, idx));
        const tok = m[0];
        if (tok.startsWith('[[')) {
            const target = tok.slice(2, -2).split('|')[0];
            const a = el.createEl('a', { cls: 'internal-link' });
            marked(a, tok.slice(2, -2).split('|').pop()!);
            a.addEventListener('click', () => openSearch(target));
        } else if (tok.startsWith('#')) {
            const a = el.createEl('a', { cls: 'tag' });
            marked(a, tok);
            a.addEventListener('click', () => openSearch(tok));
        } else if (tok.startsWith('**')) {
            marked(el.createEl('strong'), tok.slice(2, -2));
        } else if (tok.startsWith('`')) {
            marked(el.createEl('code'), tok.slice(1, -1));
        } else {
            marked(el.createEl('em'), tok.slice(1, -1));
        }
        last = idx + tok.length;
    }
    if (last < text.length) marked(el, text.substring(last));
}

function marked(el: HTMLElement, text: string): void {
    for (const s of highlight(text, editorTerms)) {
        if (s.hit) el.createEl('mark', { cls: 'the-archive-search-highlight', text: s.text });
        else el.appendText(s.text);
    }
}

// ── Toast ────────────────────────────────────────────────────────

let toastTimer = 0;
function toast(msg: string): void {
    toastEl.setText(msg);
    toastEl.addClass('is-visible');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.removeClass('is-visible'), 1800);
}

// ── Host + session ───────────────────────────────────────────────

const ACTION_VERBS: Record<FileAction, string> = {
    'open-tab': 'Opened in new tab',
    'insert-link': 'Inserted',
    'copy-link': 'Copied',
    'bookmark': 'Bookmarked',
    'rename': 'Rename',
    'move': 'Move',
    'delete': 'Deleted',
};

const host: Host = {
    read: (f) => contents.get(f) ?? '',
    preview: (f, terms) => showFile(f, terms, false),
    land: (f, terms) => {
        showFile(f, terms, true);
        closeSearch();
    },
    create: (title) => {
        const existing = [...files.values()].find((f) => f.basename.toLowerCase() === title.toLowerCase());
        if (existing) {
            host.land(existing, []);
            return;
        }
        const f = newFile(`${title}.md`, Date.now(), Date.now());
        files.set(f.path, f);
        contents.set(f, `# ${title}\n\n`);
        engine.buildIndex().then(() => {
            showFile(f, [], false);
            closeSearch();
            toast(`Created “${title}”`);
        });
    },
    close: () => closeSearch(),
    toast,
    act: (action, fs) => {
        const what = fs.length === 1 ? `“${fs[0].basename}”` : `${fs.length} notes`;
        const links = fs.map((f) => `[[${f.basename}]]`).join(' ');
        if (action === 'copy-link') navigator.clipboard?.writeText(links).catch(() => undefined);
        toast(`${ACTION_VERBS[action]} ${what}${['rename', 'move', 'delete'].includes(action) ? ' (stub)' : ''}`);
    },
};

const session = new SearchSession(engine, host);

// ── Variant mounting ─────────────────────────────────────────────

let variantKey = params.get('variant') ?? VARIANTS[0].key;
let variant: Variant = VARIANTS.find((v) => v.key === variantKey) ?? VARIANTS[0];
let unmount: (() => void) | null = null;

function openSearch(query?: string): void {
    if (unmount) {
        if (query !== undefined) session.setQuery(query);
        return;
    }
    session.open(currentFile, query);
    screen.addClass('search-open');
    layer.addClass('is-open');
    unmount = variant.mount(layer, { session, viewport, showPreviews: () => settings.showMobilePreviews });
    renderState();
}

function closeSearch(): void {
    if (!unmount) return;
    (document.activeElement as HTMLElement | null)?.blur();
    unmount();
    unmount = null;
    layer.empty();
    layer.className = 'proto-layer';
    screen.removeClass('search-open');
    renderState();
}

function setVariant(key: string): void {
    const next = VARIANTS.find((v) => v.key === key);
    if (!next) return;
    const wasOpen = !!unmount;
    if (wasOpen) closeSearch();
    variant = next;
    variantKey = key;
    params.set('variant', key);
    history.replaceState(null, '', `?${params}`);
    renderSwitcher();
    if (wasOpen) openSearch();
}

// ── Viewport → layout ────────────────────────────────────────────

function applyViewport(): void {
    const s = viewport.state;
    screen.style.setProperty('--safe-top', `${s.safeTop}px`);
    screen.style.setProperty('--safe-bottom', `${s.safeBottom}px`);
    screen.style.setProperty('--kb-h', `${s.kb}px`);
    screen.style.setProperty('--vv-h', `${s.visibleH}px`);
    screen.toggleClass('kb-open', s.open);
    layer.style.top = `${s.offsetTop}px`;
    layer.style.height = `${s.visibleH}px`;
    keyboardEl?.toggleClass('is-open', s.open);
    renderState();
}
viewport.subscribe(applyViewport);

// ── Simulated keyboard ───────────────────────────────────────────

function isField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
    return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== 'checkbox');
}

if (mode === 'sim' && keyboardEl) {
    const kb = keyboardEl;
    let symbols = false;
    let shift = false;

    const bar = kb.createDiv('proto-kb-bar');
    for (const w of ['the', 'search', 'notes']) bar.createDiv({ cls: 'proto-kb-suggest', text: w });
    const dismiss = bar.createDiv({ cls: 'proto-kb-dismiss', attr: { 'aria-label': 'Hide keyboard' } });
    setIcon(dismiss, 'keyboard-off');
    dismiss.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
    });
    const keysEl = kb.createDiv('proto-kb-keys');

    const LETTERS = ['qwertyuiop', 'asdfghjkl', '⇧zxcvbnm⌫', '123 space ⏎'];
    const SYMBOLS = ['1234567890', '-/:;()$&@"', '#.,?!\'[]⌫', 'ABC space ⏎'];

    const type = (ch: string) => {
        const el = document.activeElement;
        if (!isField(el)) return;
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        if (ch === '⌫') {
            if (start === end && start > 0) el.setRangeText('', start - 1, end, 'end');
            else el.setRangeText('', start, end, 'end');
        } else {
            el.setRangeText(ch, start, end, 'end');
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const render = () => {
        keysEl.empty();
        for (const row of symbols ? SYMBOLS : LETTERS) {
            const rowEl = keysEl.createDiv('proto-kb-row');
            const tokens = row.includes(' ') ? row.split(' ') : [...row];
            for (const t of tokens) {
                const label = t === 'space' ? 'space' : t === '⏎' ? 'go' : shift && t.length === 1 ? t.toUpperCase() : t;
                const key = rowEl.createDiv({ cls: 'proto-kb-key', text: label });
                if (['⇧', '⌫', '123', 'ABC', '⏎'].includes(t)) key.addClass('is-mod');
                if (t === 'space') key.addClass('is-space');
                if (t === '⏎') key.addClass('is-go');
                if (t === '⇧' && shift) key.addClass('is-active');
                key.addEventListener('pointerdown', (e) => {
                    e.preventDefault();
                    key.addClass('is-pressed');
                    setTimeout(() => key.removeClass('is-pressed'), 90);
                    if (t === '⇧') {
                        shift = !shift;
                        render();
                    } else if (t === '123' || t === 'ABC') {
                        symbols = !symbols;
                        render();
                    } else if (t === '⏎') {
                        document.activeElement?.dispatchEvent(
                            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
                        );
                    } else {
                        type(t === 'space' ? ' ' : shift ? t.toUpperCase() : t);
                        if (shift) {
                            shift = false;
                            render();
                        }
                    }
                });
            }
        }
    };
    render();

    document.addEventListener('focusin', (e) => {
        if (isField(e.target as Element) && screen.contains(e.target as Node)) setSimKeyboard(viewport, true);
    });
    document.addEventListener('focusout', () => {
        setTimeout(() => {
            if (!isField(document.activeElement) && viewport.state.open) setSimKeyboard(viewport, false);
        }, 20);
    });
}

// ── Switcher (outside the design being judged) ───────────────────
// Deviation from the skill's bottom-centre bar: the bottom of a phone is keyboard territory,
// so on a real phone the bar sits at the top; on desktop it sits below the drawn phone.

const switcher = document.body.createDiv('proto-switcher');
const prevBtn = switcher.createEl('button', { cls: 'proto-switcher-arrow', text: '←' });
const labelEl = switcher.createEl('button', { cls: 'proto-switcher-label' });
const nextBtn = switcher.createEl('button', { cls: 'proto-switcher-arrow', text: '→' });
const cycle = (d: number) => {
    const i = VARIANTS.findIndex((v) => v.key === variantKey);
    setVariant(VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length].key);
};
prevBtn.addEventListener('click', () => cycle(-1));
nextBtn.addEventListener('click', () => cycle(1));
labelEl.addEventListener('click', () => document.body.toggleClass('show-panel', !document.body.hasClass('show-panel')));
for (const b of [prevBtn, labelEl, nextBtn]) b.addEventListener('pointerdown', (e) => e.preventDefault());
function renderSwitcher(): void {
    labelEl.setText(`${variant.key} — ${variant.name}`);
}
renderSwitcher();
document.addEventListener('keydown', (e) => {
    const a = document.activeElement;
    if (isField(a) || (a instanceof HTMLElement && a.isContentEditable)) return;
    if (e.key === 'ArrowLeft') cycle(-1);
    if (e.key === 'ArrowRight') cycle(1);
});

// ── Control + state panel ────────────────────────────────────────

const panel = document.body.createDiv('proto-panel');
const controls = panel.createDiv('proto-controls');
panel.createEl('h4', { text: 'State' });
const stateEl: HTMLElement = panel.createEl('pre', { cls: 'proto-state' });

function button(label: string, fn: () => void): HTMLButtonElement {
    const b = controls.createEl('button', { text: label });
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', fn);
    return b;
}

controls.createEl('h4', { text: 'PROTOTYPE · mobile search' });
button('Open search (toolbar)', () => openSearch());
button('Tap [[Thumb zone]] link', () => openSearch('202501121030 Thumb zone'));
button('Tap #mobile tag', () => openSearch('#mobile'));
button('Boolean: (keyboard OR thumb) !sheet', () => openSearch('(keyboard OR thumb) !sheet'));
button('Close search', () => closeSearch());
if (mode === 'sim') {
    button('Hide keyboard', () => (document.activeElement as HTMLElement | null)?.blur());
}
button('Toggle light / dark', () => {
    const dark = screen.hasClass('theme-dark');
    screen.toggleClass('theme-dark', !dark);
    screen.toggleClass('theme-light', dark);
});
const sortSel = controls.createEl('select') as HTMLSelectElement;
for (const s of ['a-z', 'z-a', 'modified-new', 'created-new'] as SortOrder[]) sortSel.createEl('option', { text: `sort: ${s}`, value: s });
sortSel.addEventListener('change', () => {
    settings.sortOrder = sortSel.value as SortOrder;
    if (unmount) {
        const q = session.query;
        session.query = '\u0000';
        session.setQuery(q);
    }
});
button('Toggle previews setting', () => {
    settings.showMobilePreviews = !settings.showMobilePreviews;
    toast(`Previews ${settings.showMobilePreviews ? 'on' : 'off'}`);
    if (unmount) {
        unmount();
        layer.empty();
        unmount = variant.mount(layer, { session, viewport, showPreviews: () => settings.showMobilePreviews });
    }
});

function renderState(): void {
    const v = viewport.state;
    const s = session;
    const rows = s.rows();
    const activeRow = rows[s.active];
    stateEl.setText(
        [
            `variant      ${variant.key} — ${variant.name}`,
            `search open  ${!!unmount}`,
            '',
            `viewport     ${v.mode} · source=${v.source}`,
            `  keyboard   ${v.open ? `UP ${v.kb}px` : 'down'}`,
            `  visible    ${v.visibleH}px of ${v.screenH}px (top ${v.offsetTop})`,
            `  safe       top ${v.safeTop} · bottom ${v.safeBottom}`,
            '',
            `query        ${JSON.stringify(s.query)}`,
            `results      ${s.results.length}  (rows ${rows.length})`,
            `exact title  ${s.exactFilenameTerm ?? '—'}`,
            `current note ${s.currentNote?.basename ?? '—'}`,
            `active       ${s.active} ${activeRow ? `[${activeRow.kind}] ${activeRow.kind === 'create' ? activeRow.title : activeRow.file.basename}` : ''}`,
            `terms        ${JSON.stringify(s.terms())}`,
            `selecting    ${s.selecting} (${s.selected.size})`,
            `nav          ${s.navPos + 1}/${s.navStack.length}`,
            ...s.navStack.map((e, i) => `  ${i === s.navPos ? '▸' : ' '} ${JSON.stringify(e.query)}`),
            `last action  ${s.lastAction}`,
            '',
            `editor       ${currentFile.basename}`,
        ].join('\n'),
    );
}
session.subscribe(renderState);
applyViewport();

// ── Fit the drawn phone to the window ────────────────────────────

function fit(): void {
    if (mode !== 'sim') return;
    const scale = Math.min(1, (innerHeight - 96) / 868, (innerWidth - 40) / 414);
    phone.style.transform = `scale(${scale})`;
}
addEventListener('resize', fit);
fit();

// ── Boot ─────────────────────────────────────────────────────────

engine.buildIndex().then(() => {
    renderEditor();
    if (params.get('open') !== null) openSearch(params.get('open') || undefined);
});
