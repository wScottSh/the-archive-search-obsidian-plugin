// PROTOTYPE — Variant C: "Sheet over note".
//
// Search lives in a bottom sheet with detents (peek / half / full) floating over the real editor.
// Tapping a result previews it *in the editor behind* (desktop's arrow-key browse) and drops the
// sheet to a peek stepper: prev / next / open. The keyboard always gets the full visible area:
// at the full detent the sheet's top never moves, so the input never jumps when the keyboard
// comes or goes — only the sheet's bottom edge rides the keyboard.

import '../styles/variant-c.css';
import type { Variant } from './types';
import type { Row } from '../session';
import { FILE_ACTIONS, highlight, renderSegments } from '../session';
import { setIcon } from '../icons';

type Detent = 'peek' | 'half' | 'full';

const OPS: { label: string; before: string; after: string }[] = [
    { label: '"…"', before: '"', after: '"' },
    { label: '( )', before: '(', after: ')' },
    { label: 'OR', before: 'OR ', after: '' },
    { label: 'NOT', before: 'NOT ', after: '' },
    { label: '#', before: '#', after: '' },
    { label: '[[ ]]', before: '[[', after: ']]' },
];

const SHORT_LABELS: Record<string, string> = {
    'open-tab': 'New tab',
    'insert-link': 'Insert',
    'copy-link': 'Copy',
    'bookmark': 'Bookmark',
    'rename': 'Rename',
    'move': 'Move',
    'delete': 'Delete',
};

/** Zettel titles start with a 12-digit ID; show it quietly, lead with the claim. */
function splitTitle(name: string): { id: string; title: string } {
    const m = name.match(/^(\d{12})\s+(.+)$/);
    return m ? { id: m[1], title: m[2] } : { id: '', title: name };
}

export const variantC: Variant = {
    key: 'C',
    name: 'Sheet over note',
    mount(layer, ctx) {
        const { session, viewport } = ctx;

        let detent: Detent = 'full';
        let browsing = false;
        let dragging = false;
        let suppressClick = false;
        let lastActive = -1;

        // Let touches reach the editor behind the sheet (at peek, you read and scroll the note).
        const prevPointerEvents = layer.style.pointerEvents;
        layer.style.pointerEvents = 'none';

        const root = layer.createDiv('tas-c-root');
        const scrim = root.createDiv('tas-c-scrim');
        const sheet = root.createDiv('tas-c-sheet');
        sheet.createDiv({ cls: 'tas-c-grabber', attr: { 'aria-label': 'Drag to resize' } });

        // ── Header: capsule + Done ──
        const header = sheet.createDiv('tas-c-header');
        const capsule = header.createDiv('tas-c-capsule');
        setIcon(capsule.createSpan('tas-c-capsule-icon'), 'search');
        const input = capsule.createEl('input', {
            type: 'text',
            placeholder: 'Search notes',
            cls: 'tas-c-input',
            attr: {
                autocapitalize: 'off',
                autocorrect: 'off',
                autocomplete: 'off',
                spellcheck: 'false',
                enterkeyhint: 'go',
                inputmode: 'search',
            },
        }) as HTMLInputElement;
        const clearBtn = capsule.createDiv({ cls: 'tas-c-btn tas-c-clear', attr: { 'aria-label': 'Clear' } });
        setIcon(clearBtn, 'x-circle');
        const doneBtn = header.createDiv({ cls: 'tas-c-btn tas-c-done', text: 'Done' });

        // ── Meta row (keyboard down) / operator row (keyboard up) ──
        const meta = sheet.createDiv('tas-c-meta');
        const ops = sheet.createDiv('tas-c-ops');
        for (const op of OPS) {
            const chip = ops.createDiv({ cls: 'tas-c-btn tas-c-chip', text: op.label });
            chip.addEventListener('pointerdown', (e) => e.preventDefault());
            chip.addEventListener('click', () => insert(op.before, op.after));
        }

        // ── Browse stepper (peek while previewing) ──
        const stepper = sheet.createDiv('tas-c-stepper');

        const list = sheet.createDiv('tas-c-list');
        const actions = sheet.createDiv('tas-c-actions');

        // ── Geometry ──

        function detentY(d: Detent): number {
            const s = viewport.state;
            const full = s.safeTop + 8;
            if (s.open || d === 'full') return full;
            if (d === 'half') return Math.max(full, Math.round(s.visibleH * 0.5));
            return s.visibleH - ((browsing ? 86 : 72) + s.safeBottom);
        }

        function layout(): void {
            const s = viewport.state;
            const effective: Detent = s.open ? 'full' : detent;
            root.toggleClass('is-kb', s.open);
            root.toggleClass('is-browsing', browsing && !s.open);
            root.toggleClass('is-peek', effective === 'peek');
            if (!dragging) sheet.style.top = `${detentY(detent)}px`;
            scrim.style.opacity = effective === 'full' ? '1' : effective === 'half' ? '0.35' : '0';
            scrim.toggleClass('is-active', effective !== 'peek');
        }

        // ── Input ──

        function insert(before: string, after: string): void {
            const v = input.value;
            const s = input.selectionStart ?? v.length;
            const e = input.selectionEnd ?? v.length;
            const sel = v.slice(s, e);
            const prev = v[s - 1];
            const lead = prev && !/[\s(]/.test(prev) ? ' ' : '';
            input.setRangeText(lead + before + sel + after, s, e, 'end');
            if (after && !sel) {
                const caret = s + lead.length + before.length;
                input.setSelectionRange(caret, caret);
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        input.addEventListener('input', () => {
            browsing = false;
            session.setQuery(input.value);
        });
        input.addEventListener('focus', () => {
            browsing = false;
            detent = 'full';
            layout();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const rows = session.rows();
                let i = session.active;
                // Enter with the pinned current note active means "first result", not "stay here".
                if (rows[i]?.kind === 'current' && session.query.trim() && rows.length > session.offset) {
                    i = session.offset;
                }
                session.land(i);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                stepBy(e.key === 'ArrowDown' ? 1 : -1);
            } else if (e.key === 'Escape') {
                session.host.close();
            }
        });
        clearBtn.addEventListener('pointerdown', (e) => e.preventDefault());
        clearBtn.addEventListener('click', () => {
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
        });
        doneBtn.addEventListener('click', () => session.host.close());

        scrim.addEventListener('click', () => {
            input.blur();
            detent = 'peek';
            layout();
        });

        // Scrolling the results dismisses the keyboard, like iOS — more results, input stays put.
        const dismissOnScroll = () => {
            if (viewport.state.open) input.blur();
        };
        list.addEventListener('touchmove', dismissOnScroll, { passive: true });
        list.addEventListener('wheel', (e) => {
            if (Math.abs(e.deltaY) > 4) dismissOnScroll();
        }, { passive: true });

        // ── Browse ──

        function stepBy(d: number): void {
            const rows = session.rows();
            let i = session.active + d;
            while (rows[i] && rows[i].kind === 'create') i += d;
            if (i < 0 || i >= rows.length) return;
            session.activate(i);
        }

        function browse(i: number): void {
            input.blur();
            browsing = true;
            detent = 'peek';
            session.activate(i);
        }

        function backToList(): void {
            browsing = false;
            detent = 'half';
            render();
        }

        // ── Drag between detents ──

        let pid = -1;
        let startY = 0;
        let startTop = 0;
        let lastY = 0;
        let lastT = 0;
        let vel = 0;
        let moved = false;

        const isDragZone = (t: HTMLElement) =>
            !!t.closest('.tas-c-grabber, .tas-c-header, .tas-c-meta, .tas-c-stepper') && !t.closest('input, .tas-c-btn');

        sheet.addEventListener('pointerdown', (e) => {
            if (!isDragZone(e.target as HTMLElement)) return;
            pid = e.pointerId;
            startY = lastY = e.clientY;
            lastT = e.timeStamp;
            startTop = sheet.offsetTop;
            vel = 0;
            moved = false;
        });
        // Window-level: a mouse (unlike a finger) is not implicitly captured by the sheet.
        const onMove = (e: PointerEvent) => {
            if (e.pointerId !== pid) return;
            const dy = e.clientY - startY;
            if (!moved && Math.abs(dy) < 6) return;
            if (!moved) {
                moved = true;
                dragging = true;
                sheet.addClass('is-dragging');
            }
            const dt = e.timeStamp - lastT;
            if (dt > 0) vel = 0.7 * ((e.clientY - lastY) / dt) + 0.3 * vel;
            lastY = e.clientY;
            lastT = e.timeStamp;
            const min = detentY('full');
            const max = viewport.state.visibleH - 56;
            let y = startTop + dy;
            if (y < min) y = min - (min - y) * 0.25;
            sheet.style.top = `${Math.min(max, y)}px`;
            const travel = Math.max(1, detentY('peek') - min);
            scrim.style.opacity = String(Math.max(0, Math.min(1, 1 - (y - min) / travel)));
        };
        const endDrag = (e: PointerEvent) => {
            if (e.pointerId !== pid) return;
            pid = -1;
            if (!moved) return;
            dragging = false;
            sheet.removeClass('is-dragging');
            suppressNextClick();
            const top = sheet.offsetTop;
            if (viewport.state.open) {
                if (vel > 0.3 || top - detentY('full') > 60) {
                    input.blur();
                    detent = vel > 1.2 ? 'peek' : 'half';
                }
            } else {
                const projected = top + vel * 180;
                const options: Detent[] = ['full', 'half', 'peek'];
                detent = options.reduce((best, d) =>
                    Math.abs(detentY(d) - projected) < Math.abs(detentY(best) - projected) ? d : best,
                );
            }
            if (detent !== 'peek') browsing = false;
            render();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', endDrag);
        window.addEventListener('pointercancel', endDrag);

        function suppressNextClick(): void {
            suppressClick = true;
            setTimeout(() => (suppressClick = false), 60);
        }

        // ── Long-press → selection (desktop: ctrl-click / right-click) ──

        let pressTimer = 0;
        function bindLongPress(el: HTMLElement, path: string): void {
            let x = 0;
            let y = 0;
            const cancel = () => clearTimeout(pressTimer);
            const fire = () => {
                navigator.vibrate?.(10);
                suppressClick = true;
                document.addEventListener('pointerup', () => setTimeout(() => (suppressClick = false), 60), { once: true });
                session.toggleSelect(path);
            };
            el.addEventListener('pointerdown', (e) => {
                if (session.selecting) return;
                x = e.clientX;
                y = e.clientY;
                cancel();
                pressTimer = window.setTimeout(fire, 450);
            });
            el.addEventListener('pointermove', (e) => {
                if (Math.hypot(e.clientX - x, e.clientY - y) > 8) cancel();
            });
            el.addEventListener('pointerup', cancel);
            el.addEventListener('pointerleave', cancel);
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                cancel();
                if (!session.selecting) session.toggleSelect(path);
            });
        }

        // ── Render ──

        function iconBtn(parent: HTMLElement, icon: string, label: string, fn: () => void, disabled = false): HTMLElement {
            const b = parent.createDiv({ cls: 'tas-c-btn tas-c-iconbtn', attr: { 'aria-label': label } });
            setIcon(b, icon);
            b.toggleClass('is-disabled', disabled);
            b.addEventListener('click', fn);
            return b;
        }

        function textBtn(parent: HTMLElement, text: string, fn: () => void): HTMLElement {
            const b = parent.createDiv({ cls: 'tas-c-btn tas-c-textbtn', text });
            b.addEventListener('click', fn);
            return b;
        }

        function renderMeta(): void {
            meta.empty();
            if (session.selecting) {
                meta.createSpan({ cls: 'tas-c-count is-strong', text: `${session.selected.size} selected` });
                meta.createDiv('tas-c-spacer');
                textBtn(meta, 'Select all', () => session.selectAll());
                textBtn(meta, 'Cancel', () => session.clearSelection());
                return;
            }
            iconBtn(meta, 'chevron-left', 'Back', () => session.back(), !session.canBack);
            iconBtn(meta, 'chevron-right', 'Forward', () => session.forward(), !session.canForward);
            const n = session.results.length;
            meta.createSpan({
                cls: 'tas-c-count',
                text: session.query.trim() ? `${n} ${n === 1 ? 'note' : 'notes'}` : `All notes · ${n}`,
            });
            meta.createDiv('tas-c-spacer');
            if (n > 0) textBtn(meta, 'Select', () => session.startSelecting());
        }

        function renderStepper(rows: Row[]): void {
            stepper.empty();
            const row = rows[session.active];
            if (!row || row.kind === 'create') return;
            const body = stepper.createDiv('tas-c-step-body');
            const { title } = splitTitle(row.file.basename);
            renderSegments(body.createDiv('tas-c-step-title'), highlight(title, session.terms()));
            const pos = row.kind === 'current'
                ? 'Current note'
                : `${session.active - session.offset + 1} of ${session.results.length}`;
            const q = session.query.trim();
            const echo = q && !session.exactFilenameTerm ? `“${q}” · ` : session.exactFilenameTerm ? 'Linked note · ' : '';
            body.createDiv({ cls: 'tas-c-step-sub', text: echo + pos });
            body.addEventListener('click', () => {
                if (!suppressClick) backToList();
            });
            const lastFile = rows.length - 1 - (rows[rows.length - 1]?.kind === 'create' ? 1 : 0);
            iconBtn(stepper, 'chevron-up', 'Previous', () => stepBy(-1), session.active <= 0);
            iconBtn(stepper, 'chevron-down', 'Next', () => stepBy(1), session.active >= lastFile);
            const open = stepper.createDiv({ cls: 'tas-c-btn tas-c-open' });
            setIcon(open.createSpan(), 'corner-down-left');
            open.createSpan({ text: 'Open' });
            open.addEventListener('click', () => session.land());
        }

        function renderRow(row: Row, i: number, terms: string[]): HTMLElement {
            const el = list.createDiv({ cls: 'tas-c-row', attr: { role: 'button' } });
            el.toggleClass('is-active', i === session.active && !session.selecting);

            if (row.kind === 'create') {
                el.addClass('is-create');
                setIcon(el.createDiv('tas-c-row-icon'), 'file-plus');
                const body = el.createDiv('tas-c-row-body');
                body.createDiv({ cls: 'tas-c-kicker', text: 'New note' });
                body.createDiv({ cls: 'tas-c-title', text: `“${row.title}”` });
            } else {
                const file = row.file;
                const isResult = row.kind === 'result';
                if (session.selecting && isResult) {
                    const checked = session.selected.has(file.path);
                    const check = el.createDiv('tas-c-check');
                    check.toggleClass('is-checked', checked);
                    if (checked) setIcon(check, 'check');
                    el.toggleClass('is-checked', checked);
                } else if (!isResult) {
                    setIcon(el.createDiv('tas-c-row-icon'), 'file-text');
                }
                const body = el.createDiv('tas-c-row-body');
                if (!isResult) body.createDiv({ cls: 'tas-c-kicker', text: 'Current note' });
                const { id, title } = splitTitle(file.basename);
                renderSegments(body.createDiv('tas-c-title'), highlight(title, terms));
                const folder = file.parent?.path ?? '';
                if (id || folder) {
                    const sub = body.createDiv('tas-c-sub');
                    if (id) sub.createSpan({ cls: 'tas-c-id', text: id });
                    if (folder) sub.createSpan({ cls: 'tas-c-folder', text: folder });
                }
                if (isResult && ctx.showPreviews() && session.query.trim()) {
                    const segs = session.snippet(file, terms);
                    if (segs) renderSegments(body.createDiv('tas-c-snippet'), segs);
                }
                if (isResult) bindLongPress(el, file.path);
            }

            el.addEventListener('click', () => {
                if (suppressClick) return;
                if (session.selecting) {
                    if (row.kind === 'result') session.toggleSelect(row.file.path);
                    return;
                }
                if (row.kind === 'create') session.land(i);
                else browse(i);
            });
            return el;
        }

        function renderList(rows: Row[]): void {
            list.empty();
            const q = session.query.trim();
            const terms = session.terms();

            if (!q && !session.selecting) {
                const recent = session.recentQueries();
                if (recent.length) {
                    list.createDiv({ cls: 'tas-c-section', text: 'Recent' });
                    const chips = list.createDiv('tas-c-recent');
                    for (const r of recent) {
                        const chip = chips.createDiv({ cls: 'tas-c-btn tas-c-recent-chip' });
                        setIcon(chip.createSpan(), 'history');
                        chip.createSpan({ text: r });
                        chip.addEventListener('click', () => {
                            input.value = r;
                            session.setQuery(r);
                        });
                    }
                }
            }

            let activeEl: HTMLElement | null = null;
            let labelledResults = false;
            rows.forEach((row, i) => {
                if (session.selecting && row.kind !== 'result') return;
                if (row.kind === 'result' && !labelledResults && !q) {
                    list.createDiv({ cls: 'tas-c-section', text: 'All notes' });
                    labelledResults = true;
                }
                if (row.kind === 'create' && session.results.length === 0) {
                    list.createDiv({ cls: 'tas-c-empty', text: 'No notes match.' });
                }
                const el = renderRow(row, i, terms);
                if (i === session.active) activeEl = el;
            });

            if (session.active !== lastActive && activeEl) {
                const target: HTMLElement = activeEl;
                requestAnimationFrame(() => target.scrollIntoView({ block: 'nearest' }));
            }
            lastActive = session.active;
        }

        function renderActions(): void {
            actions.empty();
            root.toggleClass('is-selecting', session.selecting);
            if (!session.selecting) return;
            const n = session.selected.size;
            for (const a of FILE_ACTIONS) {
                const b = actions.createDiv({ cls: 'tas-c-btn tas-c-action' });
                if (a.danger) b.addClass('is-danger');
                b.toggleClass('is-disabled', n === 0 || (!!a.single && n > 1));
                setIcon(b.createDiv('tas-c-action-icon'), a.icon);
                b.createDiv({ cls: 'tas-c-action-label', text: SHORT_LABELS[a.id] ?? a.label });
                b.addEventListener('click', () => session.act(a.id));
            }
        }

        function render(): void {
            if (input.value !== session.query) input.value = session.query;
            capsule.toggleClass('has-value', session.query.length > 0);
            const rows = session.rows();
            renderMeta();
            renderStepper(rows);
            renderList(rows);
            renderActions();
            layout();
        }

        // A query arriving from outside (wiki-link / hashtag tapped in the note behind a peeking
        // sheet) follows the same rules as entry: exact title → preview it, else show results.
        const onSession = () => {
            const external = session.lastAction === 'search' && !viewport.state.open
                && document.activeElement !== input && detent === 'peek';
            if (external && session.exactFilenameTerm) {
                browsing = true;
                session.activate(session.active);
                return;
            }
            if (external) {
                browsing = false;
                detent = 'half';
            }
            render();
        };
        const offSession = session.subscribe(onSession);
        const offViewport = viewport.subscribe(layout);

        // ── Entry ──
        // Production would pass the entry source explicitly; here "query pushed just now" means it
        // came from a wiki-link / hashtag tap rather than the toolbar button.
        const top = session.navStack[session.navPos];
        const fresh = !!top && Date.now() - top.at < 400;

        sheet.style.top = `${viewport.state.visibleH}px`;
        render();
        void sheet.offsetHeight;

        if (fresh && session.exactFilenameTerm) {
            // [[Exact title]] → open that note behind the sheet; results one swipe away.
            browse(session.active);
        } else if (fresh && session.query.trim()) {
            detent = 'half';
            layout();
        } else {
            detent = 'full';
            input.focus();
            input.select();
            layout();
        }

        return () => {
            offSession();
            offViewport();
            clearTimeout(pressTimer);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', endDrag);
            window.removeEventListener('pointercancel', endDrag);
            layer.style.pointerEvents = prevPointerEvents;
        };
    },
};
