// PROTOTYPE — Variant B: "Split Browser". Desktop parity: a results list with a live preview
// pane of the active row, like the Omnibar beside the editor. Keyboard up → preview collapses
// to a peek strip docked on the keyboard; keyboard down → draggable split.

import '../styles/variant-b.css';
import type { TFile } from 'obsidian';
import type { Variant } from './types';
import { setIcon } from '../icons';
import { FILE_ACTIONS, Row, highlight, renderSegments } from '../session';

const SYNTAX: { label: string; hint: string; insert: string; caret?: number }[] = [
    { label: 'foo bar', hint: 'both words', insert: ' ' },
    { label: 'OR', hint: 'either side', insert: ' OR ' },
    { label: '!word', hint: 'exclude', insert: '!' },
    { label: '"phrase"', hint: 'exact text', insert: '""', caret: 1 },
    { label: '( … )', hint: 'group', insert: '()', caret: 1 },
    { label: '#tag', hint: 'tag text', insert: '#' },
];

export const variantB: Variant = {
    key: 'B',
    name: 'Split browser',
    mount(layer, { session, viewport, showPreviews }) {
        const root = layer.createDiv('tas-b');
        let split = 0.45;

        // ── Header ──
        const header = root.createDiv('tas-b-header');
        const backBtn = header.createEl('button', { cls: 'tas-b-icon', attr: { 'aria-label': 'Back' } });
        setIcon(backBtn, 'chevron-left');
        const fwdBtn = header.createEl('button', { cls: 'tas-b-icon', attr: { 'aria-label': 'Forward' } });
        setIcon(fwdBtn, 'chevron-right');
        const field = header.createDiv('tas-b-field');
        setIcon(field.createSpan('tas-b-field-icon'), 'search');
        const input = field.createEl('input', {
            cls: 'tas-b-input',
            type: 'text',
            placeholder: 'Search notes',
            attr: { autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'go' },
        }) as HTMLInputElement;
        const clearBtn = field.createEl('button', { cls: 'tas-b-clear', attr: { 'aria-label': 'Clear' } });
        setIcon(clearBtn, 'x-circle');
        const closeBtn = header.createEl('button', { cls: 'tas-b-close', text: 'Done' });

        // ── Meta row ──
        const meta = root.createDiv('tas-b-meta');
        const countEl = meta.createSpan('tas-b-count');
        meta.createSpan('tas-b-spacer');
        const selectBtn = meta.createEl('button', { cls: 'tas-b-pill' });
        const helpBtn = meta.createEl('button', { cls: 'tas-b-pill tas-b-help-btn', attr: { 'aria-label': 'Search syntax' } });
        setIcon(helpBtn, 'help-circle');

        // ── Body: list / divider / preview ──
        const body = root.createDiv('tas-b-body');
        const list = body.createDiv('tas-b-list');
        const divider = body.createDiv('tas-b-divider');
        divider.createDiv('tas-b-divider-grip');
        const pane = body.createDiv('tas-b-pane');

        // ── Syntax sheet ──
        const sheet = root.createDiv('tas-b-syntax');
        const sheetHead = sheet.createDiv('tas-b-syntax-head');
        sheetHead.createSpan({ text: 'Search syntax' });
        const sheetClose = sheetHead.createEl('button', { cls: 'tas-b-icon' });
        setIcon(sheetClose, 'x');
        const sheetGrid = sheet.createDiv('tas-b-syntax-grid');
        for (const s of SYNTAX) {
            const item = sheetGrid.createEl('button', { cls: 'tas-b-syntax-item' });
            item.createEl('code', { text: s.label });
            item.createSpan({ text: s.hint });
            item.addEventListener('pointerdown', (e) => e.preventDefault());
            item.addEventListener('click', () => insert(s.insert, s.caret));
        }

        const keepFocus = (el: HTMLElement) => el.addEventListener('pointerdown', (e) => e.preventDefault());
        [backBtn, fwdBtn, clearBtn, helpBtn, sheetClose].forEach(keepFocus);

        function insert(text: string, caret?: number): void {
            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? input.value.length;
            input.setRangeText(text, start, end, 'end');
            if (caret !== undefined) input.setSelectionRange(start + caret, start + caret);
            input.focus();
            root.removeClass('show-syntax');
            session.setQuery(input.value);
        }

        // ── Events ──
        input.addEventListener('input', () => session.setQuery(input.value));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                session.land();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                session.step(e.key === 'ArrowDown' ? 1 : -1);
            } else if (e.key === 'Escape') {
                session.host.close();
            }
        });
        backBtn.addEventListener('click', () => session.back());
        fwdBtn.addEventListener('click', () => session.forward());
        clearBtn.addEventListener('click', () => {
            session.setQuery('');
            input.focus();
        });
        closeBtn.addEventListener('click', () => session.host.close());
        selectBtn.addEventListener('click', () => {
            if (session.selecting) session.clearSelection();
            else {
                input.blur();
                session.startSelecting();
            }
        });
        helpBtn.addEventListener('click', () => root.toggleClass('show-syntax', !root.hasClass('show-syntax')));
        sheetClose.addEventListener('click', () => root.removeClass('show-syntax'));

        // Divider drag (keyboard down only)
        divider.addEventListener('pointerdown', (e) => {
            divider.setPointerCapture(e.pointerId);
            root.addClass('is-dragging');
            const rect = body.getBoundingClientRect();
            const scale = rect.height / body.offsetHeight || 1; // the drawn phone may be CSS-scaled
            const move = (ev: PointerEvent) => {
                split = Math.max(0.2, Math.min(0.8, (ev.clientY - rect.top) / scale / body.offsetHeight));
                root.style.setProperty('--tas-b-split', String(split));
            };
            const up = () => {
                root.removeClass('is-dragging');
                divider.removeEventListener('pointermove', move);
                divider.removeEventListener('pointerup', up);
                divider.removeEventListener('pointercancel', up);
            };
            divider.addEventListener('pointermove', move);
            divider.addEventListener('pointerup', up);
            divider.addEventListener('pointercancel', up);
        });
        divider.addEventListener('dblclick', () => {
            split = 0.45;
            root.style.setProperty('--tas-b-split', String(split));
        });

        // ── Rendering ──
        let lastPreviewKey = '';

        function render(): void {
            if (input.value !== session.query) input.value = session.query;
            const rows = session.rows();
            const q = session.query.trim();
            backBtn.toggleClass('is-disabled', !session.canBack);
            fwdBtn.toggleClass('is-disabled', !session.canForward);
            field.toggleClass('has-value', !!session.query);
            root.toggleClass('is-selecting', session.selecting);
            countEl.setText(
                session.selecting
                    ? `${session.selected.size} selected`
                    : q
                        ? `${session.results.length} ${session.results.length === 1 ? 'note' : 'notes'}`
                        : `All notes · ${session.results.length}`,
            );
            selectBtn.setText(session.selecting ? 'Cancel' : 'Select');
            renderList(rows, q);
            if (session.selecting) renderActions();
            else renderPreview(rows);
        }

        function renderList(rows: Row[], q: string): void {
            list.empty();
            if (!q) {
                const recent = session.recentQueries(6);
                if (recent.length) {
                    const rec = list.createDiv('tas-b-recent');
                    setIcon(rec.createSpan('tas-b-recent-icon'), 'history');
                    for (const r of recent) {
                        const chip = rec.createEl('button', { cls: 'tas-b-chip', text: r });
                        chip.addEventListener('click', () => session.setQuery(r));
                    }
                }
            }
            const terms = session.terms();
            rows.forEach((row, i) => {
                const isActive = i === session.active && !session.selecting;
                const el = list.createDiv({ cls: `tas-b-row tas-b-row-${row.kind}` });
                el.toggleClass('is-active', isActive);
                if (row.kind === 'create') {
                    setIcon(el.createSpan('tas-b-row-icon'), 'file-plus');
                    const t = el.createDiv('tas-b-row-main').createDiv('tas-b-row-title');
                    t.appendText('Create ');
                    t.createEl('strong', { text: `“${row.title}”` });
                } else {
                    if (session.selecting && row.kind === 'result') {
                        const box = el.createSpan('tas-b-check');
                        if (session.selected.has(row.file.path)) {
                            el.addClass('is-checked');
                            setIcon(box, 'check');
                        }
                    } else if (row.kind === 'current') {
                        setIcon(el.createSpan('tas-b-row-icon'), 'file-text');
                    }
                    const main = el.createDiv('tas-b-row-main');
                    const line = main.createDiv('tas-b-row-line');
                    const title = line.createDiv('tas-b-row-title');
                    if (row.kind === 'current') title.createSpan({ cls: 'tas-b-row-label', text: 'Current ' });
                    renderSegments(title, highlight(row.file.basename, terms));
                    if (row.kind === 'result' && row.result.matchInFilename) title.addClass('is-filename-match');
                    const folder = row.file.parent?.path;
                    if (folder) line.createSpan({ cls: 'tas-b-row-path', text: folder });
                    if (showPreviews() && row.kind === 'result' && q) {
                        const segs = session.snippet(row.file, terms, 40);
                        if (segs) renderSegments(main.createDiv('tas-b-row-snippet'), segs);
                    }
                }
                bindRow(el, row, i);
            });
            // Manual "nearest" scroll: scrollIntoView would also scroll overflow:hidden ancestors.
            const active = list.querySelector('.is-active') as HTMLElement | null;
            if (active) {
                const top = active.offsetTop;
                const bottom = top + active.offsetHeight;
                if (top < list.scrollTop) list.scrollTop = top;
                else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
            }
        }

        function bindRow(el: HTMLElement, row: Row, i: number): void {
            let timer = 0;
            let longPressed = false;
            let startY = 0;
            el.addEventListener('pointerdown', (e) => {
                longPressed = false;
                startY = e.clientY;
                if (row.kind !== 'result') return;
                timer = window.setTimeout(() => {
                    longPressed = true;
                    navigator.vibrate?.(10);
                    input.blur();
                    session.toggleSelect(row.file.path);
                }, 450);
            });
            el.addEventListener('pointermove', (e) => {
                if (Math.abs(e.clientY - startY) > 8) clearTimeout(timer);
            });
            const cancel = () => clearTimeout(timer);
            el.addEventListener('pointerup', cancel);
            el.addEventListener('pointercancel', cancel);
            el.addEventListener('contextmenu', (e) => e.preventDefault());
            el.addEventListener('click', () => {
                if (longPressed) return;
                if (session.selecting) {
                    if (row.kind === 'result') session.toggleSelect(row.file.path);
                    return;
                }
                if (i === session.active || row.kind === 'create') session.land(i);
                else session.activate(i);
            });
        }

        function renderPreview(rows: Row[]): void {
            const row = rows[session.active];
            const terms = session.terms();
            const key = `${row?.kind}:${row && row.kind !== 'create' ? row.file.path : row?.title}:${terms.join('|')}`;
            const kb = viewport.state.open;
            if (key === lastPreviewKey && pane.hasClass('is-preview') && pane.dataset.kb === String(kb)) return;
            lastPreviewKey = key;
            pane.dataset.kb = String(kb);
            pane.empty();
            pane.className = 'tas-b-pane is-preview';

            if (!row) {
                pane.createDiv({ cls: 'tas-b-empty', text: 'No notes match.' });
                return;
            }

            if (row.kind === 'create') {
                const card = pane.createDiv('tas-b-create');
                setIcon(card.createDiv('tas-b-create-icon'), 'file-plus');
                card.createDiv({ cls: 'tas-b-create-title', text: row.title });
                card.createDiv({ cls: 'tas-b-create-sub', text: 'No note with this title yet.' });
                const go = card.createEl('button', { cls: 'tas-b-primary', text: 'Create note' });
                go.addEventListener('click', () => session.land());
                return;
            }

            const file = row.file;
            const resultIdx = row.kind === 'result' ? session.active - session.offset + 1 : 0;

            // Peek strip (keyboard up) and full header share one element; CSS decides the shape.
            const head = pane.createDiv('tas-b-pane-head');
            const titles = head.createDiv('tas-b-pane-titles');
            titles.createDiv({ cls: 'tas-b-pane-title', text: file.basename });
            const sub = titles.createDiv('tas-b-pane-sub');
            const peekSegs = session.snippet(file, terms, 14);
            if (peekSegs) renderSegments(sub.createSpan('tas-b-pane-peekline'), peekSegs);
            sub.createSpan({
                cls: 'tas-b-pane-pos',
                text: row.kind === 'current' ? 'Current note' : `${resultIdx} of ${session.results.length}`,
            });

            const prev = head.createEl('button', { cls: 'tas-b-icon', attr: { 'aria-label': 'Previous' } });
            setIcon(prev, 'chevron-up');
            const next = head.createEl('button', { cls: 'tas-b-icon', attr: { 'aria-label': 'Next' } });
            setIcon(next, 'chevron-down');
            prev.toggleClass('is-disabled', session.active <= 0);
            next.toggleClass('is-disabled', session.active >= rows.length - 1);
            const open = head.createEl('button', { cls: 'tas-b-primary tas-b-open', text: 'Open' });
            [prev, next].forEach(keepFocus);
            prev.addEventListener('click', (e) => {
                e.stopPropagation();
                session.step(-1);
            });
            next.addEventListener('click', (e) => {
                e.stopPropagation();
                session.step(1);
            });
            open.addEventListener('click', (e) => {
                e.stopPropagation();
                session.land();
            });
            head.addEventListener('click', () => {
                if (viewport.state.open) input.blur(); // peek strip → expand preview
            });

            const doc = pane.createDiv('tas-b-doc');
            renderMarkdown(doc, session.host.read(file), terms);
            const first = doc.querySelector('mark');
            requestAnimationFrame(() => {
                if (first) doc.scrollTop = Math.max(0, (first as HTMLElement).offsetTop - doc.clientHeight / 3);
            });
        }

        function renderActions(): void {
            lastPreviewKey = '';
            pane.empty();
            pane.className = 'tas-b-pane is-actions';
            const files: TFile[] = session.targetFiles();
            const n = session.selected.size;
            const head = pane.createDiv('tas-b-actions-head');
            head.createDiv({ cls: 'tas-b-actions-title', text: n ? `${n} ${n === 1 ? 'note' : 'notes'} selected` : 'Tap notes to select' });
            const all = head.createEl('button', { cls: 'tas-b-pill', text: 'Select all' });
            all.addEventListener('click', () => session.selectAll());
            const grid = pane.createDiv('tas-b-actions');
            for (const a of FILE_ACTIONS) {
                if (a.single && n > 1) continue;
                const b = grid.createEl('button', { cls: 'tas-b-action' });
                b.toggleClass('is-danger', !!a.danger);
                b.toggleClass('is-disabled', n === 0);
                setIcon(b.createSpan('tas-b-action-icon'), a.icon);
                b.createSpan({ text: a.label });
                b.addEventListener('click', () => session.act(a.id, files));
            }
        }

        function applyViewport(): void {
            const open = viewport.state.open;
            root.toggleClass('is-kb', open);
            if (!session.selecting) renderPreview(session.rows());
        }

        const offSession = session.subscribe(render);
        const offViewport = viewport.subscribe(applyViewport);
        root.style.setProperty('--tas-b-split', String(split));
        render();
        applyViewport();
        input.focus();
        input.select();

        return () => {
            offSession();
            offViewport();
        };
    },
};

/** Tiny markdown → DOM for the preview pane: headings, lists, paragraphs, links, tags, hits. */
function renderMarkdown(el: HTMLElement, md: string, terms: string[]): void {
    let ul: HTMLElement | null = null;
    for (const raw of md.split('\n')) {
        const line = raw.trimEnd();
        if (!line.trim()) {
            ul = null;
            continue;
        }
        const h = line.match(/^(#{1,3}) (.*)$/);
        const li = line.match(/^\s*(?:[-*]|\d+\.) (.*)$/);
        let target: HTMLElement;
        if (h) {
            ul = null;
            target = el.createDiv(`tas-b-h tas-b-h${h[1].length}`);
            inline(target, h[2], terms);
        } else if (li) {
            ul = ul ?? el.createEl('ul');
            target = ul.createEl('li');
            inline(target, li[1], terms);
        } else {
            ul = null;
            target = el.createEl('p');
            inline(target, line, terms);
        }
    }
}

function inline(el: HTMLElement, text: string, terms: string[]): void {
    const re = /(\[\[[^\]]+\]\]|(?:^|(?<=\s))#[\w/-]+|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        if (m.index > last) renderSegments(el, highlight(text.substring(last, m.index), terms));
        const tok = m[0];
        let child: HTMLElement;
        let inner: string;
        if (tok.startsWith('[[')) {
            child = el.createSpan('tas-b-link');
            inner = tok.slice(2, -2).split('|').pop()!.replace(/^\d{12} /, '');
        } else if (tok.startsWith('#')) {
            child = el.createSpan('tas-b-tag');
            inner = tok;
        } else if (tok.startsWith('**')) {
            child = el.createEl('strong');
            inner = tok.slice(2, -2);
        } else if (tok.startsWith('`')) {
            child = el.createEl('code');
            inner = tok.slice(1, -1);
        } else {
            child = el.createEl('em');
            inner = tok.slice(1, -1);
        }
        renderSegments(child, highlight(inner, terms));
        last = m.index + tok.length;
    }
    if (last < text.length) renderSegments(el, highlight(text.substring(last), terms));
}
