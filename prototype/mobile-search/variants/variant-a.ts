// PROTOTYPE — Variant A, "Thumb Dock".
//
// The search capsule lives at the bottom edge of the visible area, so it rides on top of the
// keyboard while typing and settles above the home indicator when the keyboard goes away. The
// input never moves relative to its edge; the results list above it simply grows or shrinks.
//
// Ordering: the list is laid out bottom-up (flex column-reverse), so rows()[0] sits closest to
// the thumb. That puts the pinned "Current note" directly above the capsule (one tap to return to
// where you were), then results in sort order reading upward, and the "Create note" row at the
// far end — creating is the rare action, and an empty result set puts it right above the capsule
// anyway because there is nothing else to push it up. Recent-query chips (empty query only) sit
// below the current note, nearest the thumb.
//
// No `[[` operator chip: the parser treats `[[` as a literal word, which would match every note
// that contains a link.

import '../styles/variant-a.css';
import type { TFile } from 'obsidian';
import type { Variant } from './types';
import { setIcon } from '../icons';
import { FILE_ACTIONS, Row, highlight, renderSegments } from '../session';

const LONG_PRESS_MS = 450;

export const variantA: Variant = {
    key: 'A',
    name: 'Thumb Dock',
    mount(layer, { session, viewport, showPreviews }) {
        const root = layer.createDiv('tas-a-root');

        // ── Top bar ──
        const top = root.createDiv('tas-a-top');
        top.createSpan({ cls: 'tas-a-top-title', text: 'Search' });
        const countEl = top.createSpan('tas-a-top-count');
        const selectBtn = top.createEl('button', { cls: 'tas-a-text-btn', text: 'Select' });

        // ── Results ──
        const list = root.createDiv('tas-a-list');

        // ── Dock: accessory + capsule / selection bar ──
        const dock = root.createDiv('tas-a-dock');
        const accessory = dock.createDiv('tas-a-accessory');
        const capsule = dock.createDiv('tas-a-capsule');

        const backBtn = capsule.createEl('button', { cls: 'tas-a-icon-btn', attr: { 'aria-label': 'Back' } });
        setIcon(backBtn, 'chevron-left');
        const fwdBtn = capsule.createEl('button', { cls: 'tas-a-icon-btn', attr: { 'aria-label': 'Forward' } });
        setIcon(fwdBtn, 'chevron-right');

        const field = capsule.createDiv('tas-a-field');
        const searchIcon = field.createSpan('tas-a-field-icon');
        setIcon(searchIcon, 'search');
        const input = field.createEl('input', {
            cls: 'tas-a-input',
            type: 'text',
            placeholder: 'Search notes',
            value: session.query,
            attr: {
                autocapitalize: 'off',
                autocorrect: 'off',
                autocomplete: 'off',
                spellcheck: 'false',
                enterkeyhint: 'go',
                inputmode: 'search',
            },
        }) as HTMLInputElement;
        const clearBtn = field.createEl('button', { cls: 'tas-a-clear', attr: { 'aria-label': 'Clear' } });
        setIcon(clearBtn, 'x-circle');

        const closeBtn = capsule.createEl('button', { cls: 'tas-a-icon-btn', attr: { 'aria-label': 'Close' } });
        setIcon(closeBtn, 'x');

        const selBar = dock.createDiv('tas-a-selbar');

        // ── Quick Look overlay ──
        const look = root.createDiv('tas-a-look');
        let lookOpen = false;

        // Buttons in the dock must not steal focus, or the keyboard drops.
        const keepFocus = (el: HTMLElement) => el.addEventListener('pointerdown', (e) => e.preventDefault());
        [backBtn, fwdBtn, clearBtn].forEach(keepFocus);

        // ── Operator accessory ──
        const OPS: { label: string; before: string; after?: string; hint: string }[] = [
            { label: '" "', before: '"', after: '"', hint: 'Exact phrase' },
            { label: '( )', before: '(', after: ')', hint: 'Group' },
            { label: 'OR', before: ' OR ', hint: 'Either' },
            { label: 'NOT', before: '!', hint: 'Exclude' },
            { label: '#', before: '#', hint: 'Tag' },
        ];
        const chips = accessory.createDiv('tas-a-ops');
        for (const op of OPS) {
            const chip = chips.createEl('button', { cls: 'tas-a-op', text: op.label, attr: { 'aria-label': op.hint } });
            keepFocus(chip);
            chip.addEventListener('click', () => insert(op.before, op.after ?? ''));
        }
        const accCount = accessory.createSpan('tas-a-acc-count');

        function insert(before: string, after: string): void {
            const start = input.selectionStart ?? input.value.length;
            const end = input.selectionEnd ?? input.value.length;
            const sel = input.value.substring(start, end);
            let pre = before;
            // Collapse doubled spaces around " OR ".
            if (pre.startsWith(' ') && (start === 0 || input.value[start - 1] === ' ')) pre = pre.trimStart();
            input.setRangeText(pre + sel + after, start, end, 'end');
            if (after && !sel) {
                const caret = start + pre.length;
                input.setSelectionRange(caret, caret);
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // ── Events ──
        input.addEventListener('input', () => session.setQuery(input.value));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                session.land();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                if (lookOpen) setLook(false);
                else if (session.selecting) session.clearSelection();
                else session.host.close();
            }
        });
        clearBtn.addEventListener('click', () => {
            input.value = '';
            session.setQuery('');
            input.focus();
        });
        closeBtn.addEventListener('click', () => session.host.close());
        backBtn.addEventListener('click', () => session.back());
        fwdBtn.addEventListener('click', () => session.forward());
        selectBtn.addEventListener('click', () => {
            if (session.selecting) session.clearSelection();
            else {
                input.blur();
                session.startSelecting();
            }
        });

        // Scrolling the list means "I'm reading now" — drop the keyboard to show more.
        const dismissOnScroll = () => {
            if (viewport.state.open && document.activeElement === input) input.blur();
        };
        list.addEventListener('touchmove', dismissOnScroll, { passive: true });
        list.addEventListener('wheel', dismissOnScroll, { passive: true });

        // ── Rows ──

        function fileRowIndices(): number[] {
            return session.rows().flatMap((r, i) => (r.kind === 'create' ? [] : [i]));
        }

        function renderRow(row: Row, i: number): HTMLElement {
            const terms = session.terms(i);
            const el = list.createDiv('tas-a-row');
            el.toggleClass('is-active', i === session.active && !!session.query.trim());

            if (row.kind === 'create') {
                el.addClass('tas-a-row-create');
                const ic = el.createSpan('tas-a-row-icon');
                setIcon(ic, 'file-plus');
                const body = el.createDiv('tas-a-row-body');
                body.createDiv({ cls: 'tas-a-row-kicker', text: 'Create note' });
                body.createDiv({ cls: 'tas-a-row-title', text: `“${row.title}”` });
                bindPress(el, i, null);
                return el;
            }

            const file = row.file;
            const selected = session.selected.has(file.path);
            if (session.selecting && row.kind === 'result') {
                const box = el.createSpan('tas-a-check');
                box.toggleClass('is-checked', selected);
                if (selected) setIcon(box, 'check');
                el.toggleClass('is-selected', selected);
            }

            const body = el.createDiv('tas-a-row-body');
            if (row.kind === 'current') {
                el.addClass('tas-a-row-current');
                const k = body.createDiv('tas-a-row-kicker');
                const ki = k.createSpan('tas-a-kicker-icon');
                setIcon(ki, 'file-text');
                k.appendText('Current note');
            }

            const titleLine = body.createDiv('tas-a-row-titleline');
            const title = titleLine.createSpan('tas-a-row-title');
            renderSegments(title, highlight(file.basename, terms));
            if (row.kind === 'result' && row.result.matchInFilename) title.addClass('is-filename-match');
            const folder = file.parent?.path;
            if (folder) titleLine.createSpan({ cls: 'tas-a-row-path', text: folder });

            if (row.kind === 'result' && showPreviews()) {
                const segs = session.snippet(file, terms);
                if (segs) renderSegments(body.createDiv('tas-a-row-snippet'), segs);
            }

            if (!session.selecting) {
                const peek = el.createEl('button', { cls: 'tas-a-peek', attr: { 'aria-label': 'Quick look' } });
                setIcon(peek, 'eye');
                peek.addEventListener('click', (e) => {
                    e.stopPropagation();
                    session.activate(i);
                    setLook(true);
                });
            }

            bindPress(el, i, row.kind === 'result' ? file : null);
            return el;
        }

        /** Tap = land (or toggle in selection mode). Long-press = start selecting. */
        function bindPress(el: HTMLElement, i: number, selectable: TFile | null): void {
            let timer = 0;
            let fired = false;
            let x = 0;
            let y = 0;
            el.addEventListener('pointerdown', (e) => {
                fired = false;
                x = e.clientX;
                y = e.clientY;
                el.addClass('is-pressing');
                if (!selectable) return;
                timer = window.setTimeout(() => {
                    fired = true;
                    el.removeClass('is-pressing');
                    navigator.vibrate?.(10);
                    input.blur();
                    session.toggleSelect(selectable.path);
                }, LONG_PRESS_MS);
            });
            const cancel = () => {
                clearTimeout(timer);
                el.removeClass('is-pressing');
            };
            el.addEventListener('pointermove', (e) => {
                if (Math.abs(e.clientX - x) > 8 || Math.abs(e.clientY - y) > 8) cancel();
            });
            el.addEventListener('pointerup', cancel);
            el.addEventListener('pointercancel', cancel);
            el.addEventListener('pointerleave', cancel);
            el.addEventListener('contextmenu', (e) => e.preventDefault());
            el.addEventListener('click', () => {
                if (fired) return;
                if (session.selecting) {
                    if (selectable) session.toggleSelect(selectable.path);
                } else {
                    session.land(i);
                }
            });
        }

        // ── Render ──

        let lastQuery: string | null = null;

        function render(): void {
            if (input.value !== session.query) input.value = session.query;
            const q = session.query.trim();
            root.toggleClass('has-query', !!q);
            root.toggleClass('is-selecting', session.selecting);

            const n = session.results.length;
            const countText = q ? `${n} ${n === 1 ? 'match' : 'matches'}` : `${n} notes`;
            countEl.setText(countText);
            accCount.setText(countText);
            selectBtn.setText(session.selecting ? 'Done' : 'Select');
            backBtn.toggleClass('is-disabled', !session.canBack);
            fwdBtn.toggleClass('is-disabled', !session.canForward);
            clearBtn.toggleClass('is-hidden', !session.query);

            const sameQuery = lastQuery === session.query;
            const scroll = list.scrollTop;
            list.empty();

            const rows = session.rows();
            // column-reverse: first child renders at the bottom, nearest the capsule.
            let i = 0;
            if (rows[0]?.kind === 'current') renderRow(rows[0], i++);
            if (!q) {
                const recents = session.recentQueries();
                if (recents.length) {
                    const strip = list.createDiv('tas-a-recents');
                    const lab = strip.createSpan('tas-a-recents-label');
                    setIcon(lab, 'history');
                    for (const r of recents) {
                        const chip = strip.createEl('button', { cls: 'tas-a-recent', text: r });
                        keepFocus(chip);
                        chip.addEventListener('click', () => session.setQuery(r));
                    }
                }
            }
            if (q && n === 0) list.createDiv({ cls: 'tas-a-empty', text: 'No notes match' });
            for (; i < rows.length; i++) renderRow(rows[i], i);
            list.createDiv('tas-a-list-cap');

            if (sameQuery) list.scrollTop = scroll;
            else list.scrollTop = 0;
            lastQuery = session.query;

            renderSelBar();
            if (lookOpen) renderLook();
        }

        function renderSelBar(): void {
            selBar.empty();
            if (!session.selecting) return;
            const head = selBar.createDiv('tas-a-selbar-head');
            const cancel = head.createEl('button', { cls: 'tas-a-text-btn', text: 'Cancel' });
            cancel.addEventListener('click', () => session.clearSelection());
            const count = session.selected.size;
            head.createSpan({ cls: 'tas-a-selbar-count', text: count ? `${count} selected` : 'Select notes' });
            const all = head.createEl('button', { cls: 'tas-a-text-btn', text: 'Select all' });
            all.addEventListener('click', () => session.selectAll());

            const actions = selBar.createDiv('tas-a-selbar-actions');
            for (const a of FILE_ACTIONS) {
                if (a.single && count > 1) continue;
                const b = actions.createEl('button', { cls: 'tas-a-action' });
                b.toggleClass('is-danger', !!a.danger);
                b.toggleClass('is-disabled', count === 0);
                const ic = b.createSpan('tas-a-action-icon');
                setIcon(ic, a.icon);
                b.createSpan({ cls: 'tas-a-action-label', text: a.label.replace('…', '').replace(' at cursor', '') });
                b.addEventListener('click', () => session.act(a.id));
            }
        }

        // ── Quick Look ──

        function setLook(open: boolean): void {
            lookOpen = open;
            if (open) input.blur();
            look.toggleClass('is-open', open);
            if (open) renderLook();
        }

        function renderLook(): void {
            look.empty();
            const file = session.fileAt(session.active);
            if (!file) {
                setLook(false);
                return;
            }
            const terms = session.terms();
            const idxs = fileRowIndices();
            const pos = idxs.indexOf(session.active);

            const head = look.createDiv('tas-a-look-head');
            const close = head.createEl('button', { cls: 'tas-a-icon-btn', attr: { 'aria-label': 'Close' } });
            setIcon(close, 'chevron-down');
            close.addEventListener('click', () => setLook(false));
            const meta = head.createDiv('tas-a-look-meta');
            meta.createDiv({ cls: 'tas-a-look-title', text: file.basename });
            if (file.parent?.path) meta.createDiv({ cls: 'tas-a-look-path', text: file.parent.path });

            const body = look.createDiv('tas-a-look-body');
            let first: HTMLElement | null = null;
            const lines = session.host.read(file).split('\n');
            if (/^# /.test(lines[0])) lines.shift(); // the title is already in the header
            for (const line of lines) {
                if (!line.trim()) continue;
                const h = line.match(/^#{1,3} (.*)$/);
                const li = line.match(/^\s*(?:[-*]|\d+\.) (.*)$/);
                const el = body.createEl(h ? 'h3' : li ? 'li' : 'p');
                const text = (h ? h[1] : li ? li[1] : line).replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2').replace(/\*\*?|`/g, '');
                renderSegments(el, highlight(text, terms));
                first = first ?? el.querySelector('mark');
            }
            requestAnimationFrame(() => first?.scrollIntoView({ block: 'center' }));

            // Horizontal swipe = previous / next result (desktop arrow-key browse).
            let sx = 0;
            let sy = 0;
            body.addEventListener('pointerdown', (e) => {
                sx = e.clientX;
                sy = e.clientY;
            });
            body.addEventListener('pointerup', (e) => {
                const dx = e.clientX - sx;
                if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - sy) * 1.5) go(dx < 0 ? 1 : -1);
            });

            const foot = look.createDiv('tas-a-look-foot');
            const nav = foot.createDiv('tas-a-look-nav');
            const prev = nav.createEl('button', { cls: 'tas-a-icon-btn', attr: { 'aria-label': 'Previous result' } });
            setIcon(prev, 'chevron-up');
            prev.toggleClass('is-disabled', pos <= 0);
            prev.addEventListener('click', () => go(-1));
            nav.createSpan({ cls: 'tas-a-look-pos', text: `${pos + 1} of ${idxs.length}` });
            const next = nav.createEl('button', { cls: 'tas-a-icon-btn', attr: { 'aria-label': 'Next result' } });
            setIcon(next, 'chevron-down');
            next.toggleClass('is-disabled', pos >= idxs.length - 1);
            next.addEventListener('click', () => go(1));

            const link = foot.createEl('button', { cls: 'tas-a-btn' });
            const li = link.createSpan('tas-a-btn-icon');
            setIcon(li, 'link');
            link.appendText('Insert link');
            link.addEventListener('click', () => {
                session.act('insert-link', [file]);
            });
            const open = foot.createEl('button', { cls: 'tas-a-btn is-primary', text: 'Open' });
            open.addEventListener('click', () => session.land());

            function go(d: number): void {
                const target = idxs[pos + d];
                if (target !== undefined) session.activate(target);
            }
        }

        // ── Wire up ──

        const applyViewport = () => {
            root.toggleClass('kb-open', viewport.state.open);
        };
        const offSession = session.subscribe(render);
        const offViewport = viewport.subscribe(applyViewport);
        render();
        applyViewport();
        input.focus();
        requestAnimationFrame(() => root.addClass('is-in'));

        return () => {
            offSession();
            offViewport();
        };
    },
};
