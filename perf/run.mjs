/**
 * Emulated-phone perf harness for the mobile search flow.
 *
 *   npm run perf -- [--runs 5] [--throttle 4] [--save baseline]
 *
 * Each run is a cold page in a fresh context (411x914, DPR 2.625, touch,
 * CPU throttled through CDP) that walks the user's flow: index build at
 * startup, tap to open search, keyboard animating up, scrolling the full
 * list away from the thumb, typing "game". Then checks that scrolling to the
 * far end reaches every row.
 * Prints median [min-max] per metric; --save writes perf/results/<name>.json.
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
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

const FRAME_MS = 1000 / 60;
const KEY_GAP_MS = 180;
const KEYBOARD_PX = 330;
const KEYBOARD_MS = 250;
const SCROLL_PX_PER_FRAME = 60;
const SCROLL_MS = 1500;

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

async function oneRun(browser) {
    const context = await browser.newContext({
        viewport: { width: 411, height: 914 },
        deviceScaleFactor: 2.625,
        isMobile: true,
        hasTouch: true,
    });
    const page = await context.newPage();
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
        scroll: frameStats(scroll.recording),
        typedRowsAtEnd,
        allRowsAtEnd,
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
const version = browser.version();
await browser.close();

const summary = {};
for (const scenario of ['index', 'open', 'keyboard', 'type', 'scroll']) {
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
console.log(`\nchecks\n  ${[...new Set(checks)].join('\n  ')}`);

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
        keyGapMs: KEY_GAP_MS,
        keyboard: `${KEYBOARD_PX}px over ${KEYBOARD_MS}ms`,
        scroll: `${SCROLL_PX_PER_FRAME}px per frame for ${SCROLL_MS}ms`,
    };
    const file = path.join(dir, 'results', `${save}.json`);
    writeFileSync(file, JSON.stringify({ meta, summary, runs: results }, null, 2) + '\n');
    console.log(`\nsaved ${path.relative(process.cwd(), file)}`);
}
