/**
 * Emulated-phone perf harness for the mobile search flow.
 *
 *   npm run perf -- [--runs 5] [--throttle 4] [--vault <dir>] [--app-css <file>] [--save baseline] [--profile name]
 *
 * Each run is a cold page in a fresh context (411x914, DPR 2.625, touch,
 * CPU throttled through CDP) that walks the user's flow: index build at
 * startup, tap to open search, keyboard animating up, scrolling the full
 * list away from the thumb, typing "game". Then checks that scrolling to the
 * far end reaches every row, clears the field, and thumb-types "blah" a key
 * every 70 ms and deletes it the same way. Keys are sent on the clock without
 * waiting for the page, as a phone keyboard does, so a busy page queues them.
 * Last, it times engine.search alone for short queries.
 *
 * --vault reads every .md under <dir> (skipping dot folders) in place of the
 * synthetic vault. --app-css loads a stylesheet ahead of the plugin's, such as
 * Obsidian's own app.css, whose thousands of rules every new row is matched
 * against on a device. --profile writes a CPU profile of the fast typing from one
 * extra unreported run to perf/out/<name>.cpuprofile and prints its top costs.
 * Prints median [min-max] per metric; --save writes perf/results/<name>.json.
 */

import { execSync } from 'child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import esbuild from 'esbuild';
import { chromium } from 'playwright-core';

const dir = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? fallback : process.argv[i + 1];
}

const runs = Number(arg('runs', 5));
const throttle = Number(arg('throttle', 4));
const save = arg('save', undefined);
const vaultDir = arg('vault', undefined);
const profile = arg('profile', undefined);
const appCss = arg('app-css', undefined);

const FRAME_MS = 1000 / 60;
const KEY_GAP_MS = 180;
const KEYBOARD_PX = 330;
const KEYBOARD_MS = 250;
const SCROLL_PX_PER_FRAME = 60;
const SCROLL_MS = 1500;
const FAST_KEY_GAP_MS = 70;
const FAST_WORD = 'blah';
const BENCH_QUERIES = ['b', 'bl', 'bla', 'blah', 'e'];
const BENCH_ITERATIONS = 40;

function readVault(root) {
    const notes = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.')) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.md')) {
                const stat = statSync(full);
                notes.push({
                    path: path.relative(root, full).split(path.sep).join('/'),
                    content: readFileSync(full, 'utf8'),
                    ctime: stat.birthtimeMs || stat.ctimeMs,
                    mtime: stat.mtimeMs,
                });
            }
        }
    };
    walk(root);
    return notes;
}

const appCssScript = appCss && `document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = ${JSON.stringify(readFileSync(appCss, 'utf8'))};
    document.head.prepend(style);
});`;

const vaultScript = vaultDir ? `window.perfVault = ${JSON.stringify(readVault(path.resolve(vaultDir)))};` : undefined;

await esbuild.build({
    entryPoints: [path.join(dir, 'harness.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2018',
    outfile: path.join(dir, 'out/harness.js'),
    logLevel: 'warning',
    plugins: [{
        name: 'obsidian-shim',
        setup(build) {
            build.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.join(dir, 'obsidian-shim.ts') }));
        },
    }],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function frameStats(recording) {
    const dropped = recording.frameIntervals.reduce((sum, interval) => sum + Math.max(0, Math.round(interval / FRAME_MS) - 1), 0);
    return {
        longTaskCount: recording.longTasks.length,
        longTaskTotalMs: recording.longTasks.reduce((sum, ms) => sum + ms, 0),
        worstTaskMs: Math.max(0, ...recording.longTasks),
        droppedFrames: dropped,
        worstFrameMs: Math.max(0, ...recording.frameIntervals),
    };
}

async function record(page, action) {
    await page.evaluate(() => window.perfHarness.startRecording());
    const extra = await action();
    const recording = await page.evaluate(() => window.perfHarness.stopRecording());
    const state = await page.evaluate(() => window.perfHarness.state());
    return { recording, state, extra };
}

const KEY_DEFS = {
    Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
};

/** Send a key down and up without waiting for the page to handle it. */
function sendKey(cdp, key) {
    const def = KEY_DEFS[key] ?? { key, code: `Key${key.toUpperCase()}`, text: key, unmodifiedText: key, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) };
    return Promise.all([
        cdp.send('Input.dispatchKeyEvent', { type: def.text ? 'keyDown' : 'rawKeyDown', ...def }),
        cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...def }),
    ]);
}

/** Send `keys` every `gap` ms on the wall clock, then wait for the page to settle. */
async function thumbType(page, cdp, keys) {
    const start = Date.now();
    const sent = [];
    for (let i = 0; i < keys.length; i++) {
        const wait = start + i * FAST_KEY_GAP_MS - Date.now();
        if (wait > 0) await sleep(wait);
        sent.push(sendKey(cdp, keys[i]));
    }
    await Promise.all(sent);
    await sleep(500);
}

function keystrokeStats(recording, state, expectedCount, finalQuery) {
    const strokes = recording.keystrokes;
    const last = strokes[strokes.length - 1];
    const firstSent = strokes[0].sentAt;
    return {
        ...frameStats(recording),
        keystrokes: strokes.length,
        keyToPaintMs: strokes.map((s) => s.paintedAt - s.sentAt),
        worstKeyToPaintMs: Math.max(...strokes.map((s) => s.paintedAt - s.sentAt)),
        handlerMs: strokes.map((s) => s.handlerEnd - s.handlerStart),
        totalHandlerMs: strokes.reduce((sum, s) => sum + s.handlerEnd - s.handlerStart, 0),
        totalSearchMs: strokes.reduce((sum, s) => sum + s.searchMs, 0),
        queuedMs: strokes.map((s) => s.handlerStart - s.sentAt),
        sentGapsMs: strokes.slice(1).map((s, i) => s.sentAt - strokes[i].sentAt),
        lastKeyToFinalPaintMs: last.paintedAt - last.sentAt,
        firstKeyToFinalPaintMs: last.paintedAt - firstSent,
        query: state.query,
        matchCount: state.matchCount,
        correct: state.query === finalQuery && state.matchCount.startsWith(`${expectedCount} `),
    };
}

async function startProfile(cdp) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    await cdp.send('Profiler.start');
}

/** Self time per function, heaviest first. */
function topCosts(profileData, limit = 20) {
    const byId = new Map(profileData.nodes.map((node) => [node.id, node]));
    const self = new Map();
    const deltas = profileData.timeDeltas;
    for (let i = 0; i < profileData.samples.length; i++) {
        const node = byId.get(profileData.samples[i]);
        const frame = node.callFrame;
        const file = frame.url.split('/').pop();
        const name = `${frame.functionName || '(anonymous)'} ${file ? `${file}:${frame.lineNumber + 1}` : ''}`.trim();
        self.set(name, (self.get(name) ?? 0) + (deltas[i] ?? 0) / 1000);
    }
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    const idle = self.get('(idle)') ?? 0;
    return {
        busyMs: total - idle,
        top: [...self.entries()].filter(([name]) => name !== '(idle)').sort((a, b) => b[1] - a[1]).slice(0, limit)
            .map(([name, ms]) => ({ name, ms: Math.round(ms * 10) / 10 })),
    };
}

const TRACE_EVENTS = ['EventDispatch', 'FunctionCall', 'UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize', 'Commit', 'ParseHTML', 'MinorGC', 'MajorGC', 'V8.GC_SCAVENGER', 'V8.GC_MARK_COMPACTOR'];

/** Total ms per renderer main-thread event kind; nested kinds overlap their parents. */
function traceTotals(trace) {
    const events = JSON.parse(trace).traceEvents;
    const main = events.find((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
    const totals = {};
    const counts = {};
    for (const e of events) {
        if (e.pid !== main.pid || e.tid !== main.tid || e.ph !== 'X' || !TRACE_EVENTS.includes(e.name)) continue;
        totals[e.name] = Math.round(((totals[e.name] ?? 0) + e.dur / 1000) * 10) / 10;
        counts[e.name] = (counts[e.name] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(totals).map(([name, ms]) => [name, { ms, count: counts[name] }]));
}

async function oneRun(browser, profileName) {
    const context = await browser.newContext({
        viewport: { width: 411, height: 914 },
        deviceScaleFactor: 2.625,
        isMobile: true,
        hasTouch: true,
    });
    const page = await context.newPage();
    if (vaultScript) await page.addInitScript({ content: vaultScript });
    if (appCssScript) await page.addInitScript({ content: appCssScript });
    await page.goto(pathToFileURL(path.join(dir, 'page.html')).href);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    await sleep(300);

    const index = await record(page, () => page.evaluate(() => window.perfHarness.buildIndex()));
    await sleep(500);

    const open = await record(page, async () => {
        await page.tap('.perf-open');
        await sleep(1500);
    });

    const keyboard = await record(page, () => page.evaluate(
        ([px, ms]) => window.perfHarness.raiseKeyboard(px, ms), [KEYBOARD_PX, KEYBOARD_MS]));
    await sleep(300);

    const scroll = await record(page, () => page.evaluate(
        ([px, ms]) => window.perfHarness.scrollList(px, ms), [SCROLL_PX_PER_FRAME, SCROLL_MS]));
    await sleep(300);

    const type = await record(page, async () => {
        for (const key of 'game') {
            await page.keyboard.type(key);
            await sleep(KEY_GAP_MS);
        }
        await sleep(1000);
    });

    const typedRowsAtEnd = await page.evaluate(() => window.perfHarness.scrollToEnd());
    await page.click('.mobile-search-icon-btn[aria-label="Clear"]');
    const allRowsAtEnd = await page.evaluate(() => window.perfHarness.scrollToEnd());
    // Back to a freshly opened search: empty field, first batch of rows, list at the thumb end
    await page.keyboard.press('x');
    await page.keyboard.press('Backspace');
    await sleep(500);

    if (profileName) {
        await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8', 'blink'] });
        await startProfile(cdp);
    }
    const fastType = await record(page, () => thumbType(page, cdp, [...FAST_WORD]));
    await sleep(500);
    const fastDelete = await record(page, () => thumbType(page, cdp, [...FAST_WORD].map(() => 'Backspace')));
    if (profileName) {
        const { profile: data } = await cdp.send('Profiler.stop');
        const trace = (await browser.stopTracing()).toString();
        writeFileSync(path.join(dir, 'out', `${profileName}.cpuprofile`), JSON.stringify(data));
        writeFileSync(path.join(dir, 'out', `${profileName}.trace.json`), trace);
        await context.close();
        return { ...topCosts(data), trace: traceTotals(trace) };
    }
    const typedCount = await page.evaluate((q) => window.perfHarness.expectedCount(q), FAST_WORD);
    const clearedCount = await page.evaluate(() => window.perfHarness.expectedCount(''));
    const bench = await page.evaluate(([queries, n]) => window.perfHarness.benchSearch(queries, n), [BENCH_QUERIES, BENCH_ITERATIONS]);

    const vault = await page.evaluate(() => window.perfHarness.vaultStats());
    await context.close();
    return {
        vault,
        index: { ...frameStats(index.recording), indexMs: index.extra.indexMs, indexed: index.extra.indexed },
        open: {
            ...frameStats(open.recording),
            tapToPaintMs: open.recording.openToPaintMs[0],
            rowsInDom: open.state.rowsInDom,
            matchCount: open.state.matchCount,
            inputFocused: open.state.inputFocused,
        },
        keyboard: frameStats(keyboard.recording),
        type: {
            ...frameStats(type.recording),
            keyToPaintMs: type.recording.inputToPaintMs,
            worstKeyToPaintMs: Math.max(...type.recording.inputToPaintMs),
            query: type.state.query,
            rowsInDom: type.state.rowsInDom,
            matchCount: type.state.matchCount,
        },
        scroll: { ...frameStats(scroll.recording), rowsInDom: scroll.state.rowsInDom },
        typedRowsAtEnd,
        allRowsAtEnd,
        fastType: keystrokeStats(fastType.recording, fastType.state, typedCount, FAST_WORD),
        fastDelete: keystrokeStats(fastDelete.recording, fastDelete.state, clearedCount, ''),
        bench: Object.fromEntries(bench.map((b) => [`search_${b.query}`, b.medianMs])),
        benchMatches: Object.fromEntries(bench.map((b) => [b.query, b.matches])),
    };
}

function summarize(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return { median, min: sorted[0], max: sorted[sorted.length - 1] };
}

const browser = await chromium.launch();
const results = [];
for (let i = 0; i < runs; i++) {
    results.push(await oneRun(browser));
    process.stdout.write(`run ${i + 1}/${runs} done\n`);
}
let profileSummary;
if (profile) {
    profileSummary = await oneRun(browser, profile);
    console.log(`\nprofile of fast typing + deleting (unreported run) -> perf/out/${profile}.cpuprofile, busy ${Math.round(profileSummary.busyMs)} ms`);
    for (const { name, ms } of profileSummary.top) console.log(`  ${String(ms).padStart(8)}  ${name}`);
    console.log(`trace -> perf/out/${profile}.trace.json, main-thread totals`);
    for (const [name, { ms, count }] of Object.entries(profileSummary.trace)) console.log(`  ${String(ms).padStart(8)}  ${name} x${count}`);
}
const version = browser.version();
await browser.close();

const summary = {};
for (const scenario of ['index', 'open', 'keyboard', 'type', 'scroll', 'fastType', 'fastDelete', 'bench']) {
    summary[scenario] = {};
    for (const [metric, value] of Object.entries(results[0][scenario])) {
        if (typeof value === 'number') summary[scenario][metric] = summarize(results.map((run) => run[scenario][metric]));
    }
}

const round = (n) => (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
for (const [scenario, metrics] of Object.entries(summary)) {
    console.log(`\n${scenario}`);
    for (const [metric, { median, min, max }] of Object.entries(metrics)) {
        console.log(`  ${metric.padEnd(18)} ${String(round(median)).padStart(7)}  [${round(min)}-${round(max)}]`);
    }
}
const checks = results.map((run) => `${run.vault.notes} notes ${(run.vault.totalChars / 1e6).toFixed(1)}M chars | ${run.index.indexed} indexed | open: ${run.open.matchCount} focused=${run.open.inputFocused} | typed "${run.type.query}" -> ${run.type.matchCount}, ${run.type.rowsInDom} rows in DOM, scrolled to the end: ${run.typedRowsAtEnd} rows typed, ${run.allRowsAtEnd} rows cleared`);
const fastChecks = results.map((run) => `fast typed "${run.fastType.query}" ${run.fastType.keystrokes} keys -> ${run.fastType.matchCount} correct=${run.fastType.correct} | deleted to "${run.fastDelete.query}" ${run.fastDelete.keystrokes} keys -> ${run.fastDelete.matchCount} correct=${run.fastDelete.correct} | bench matches ${JSON.stringify(run.benchMatches)}`);
console.log(`\nchecks\n  ${[...new Set([...checks, ...fastChecks])].join('\n  ')}`);

if (save) {
    const meta = {
        date: new Date().toISOString(),
        commit: execSync('git rev-parse --short HEAD', { cwd: dir }).toString().trim(),
        dirty: execSync('git status --porcelain -- ../src ../main.ts', { cwd: dir }).toString().trim() !== '',
        runs,
        cpuThrottle: throttle,
        host: os.cpus()[0].model,
        chromium: version,
        viewport: '411x914 @2.625 touch',
        vault: vaultDir ?? 'synthetic',
        appCss: appCss ?? null,
        keyGapMs: KEY_GAP_MS,
        fastKeyGapMs: FAST_KEY_GAP_MS,
        benchIterations: BENCH_ITERATIONS,
        keyboard: `${KEYBOARD_PX}px over ${KEYBOARD_MS}ms`,
        scroll: `${SCROLL_PX_PER_FRAME}px per frame for ${SCROLL_MS}ms`,
    };
    const file = path.join(dir, 'results', `${save}.json`);
    writeFileSync(file, JSON.stringify({ meta, summary, profile: profileSummary, runs: results }, null, 2) + '\n');
    console.log(`\nsaved ${path.relative(process.cwd(), file)}`);
}
