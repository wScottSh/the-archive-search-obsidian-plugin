/**
 * In-page side of the perf harness: mounts the real SearchEngine, SearchSession
 * and MobileSearchModal over a synthetic vault, or the notes `run.mjs --vault`
 * injects as `window.perfVault`, and records long tasks, frames and keystrokes.
 * `perf/run.mjs` drives it through Playwright.
 */

import { App, MarkdownView, TFile } from './obsidian-shim';
import { DiskNote, makeVault, vaultFromNotes } from './vault';
import { SearchEngine } from '../src/search-engine';
import { MobileSearchModal } from '../src/mobile-search-modal';
import type { ArchiveSearchSettings } from '../src/settings';
import type TheArchiveSearchPlugin from '../main';

const settings: ArchiveSearchSettings = {
    interceptWikiLinks: true,
    highlightMatches: true,
    sortOrder: 'z-a',
    omnibarPosition: 'right',
    showRibbonIcon: true,
    respectObsidianExcluded: true,
    showMobilePreviews: true,
    excludedFolders: ['templates', ''],
    newNoteLocation: 'vault-root',
    newNoteFolder: '',
};

/** A disk read completes in a later task, as Capacitor's bridge does. */
function nextTask(): Promise<void> {
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => resolve();
        channel.port2.postMessage(0);
    });
}

/** Resolves once the frame after now has been laid out and painted. */
function afterNextFrame(): Promise<number> {
    return new Promise((resolve) => requestAnimationFrame(() => nextTask().then(() => resolve(performance.now()))));
}

/** A visualViewport the harness can shrink, standing in for the soft keyboard. */
class FakeViewport extends EventTarget {
    height = window.innerHeight;
    offsetTop = 0;
}

interface LongTask {
    start: number;
    duration: number;
}

const longTasks: LongTask[] = [];
new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration });
}).observe({ type: 'longtask', buffered: true });

let frames: number[] = [];
let recording = false;
let recordStart = 0;

function frameLoop(time: number): void {
    if (!recording) return;
    frames.push(time);
    requestAnimationFrame(frameLoop);
}

const diskNotes = (window as any).perfVault as DiskNote[] | undefined;
const vault = diskNotes ? vaultFromNotes(diskNotes) : makeVault();
const viewport = new FakeViewport();
Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => viewport });

const currentNote = vault.files.find((file) => !file.path.startsWith('templates/')) as TFile;
const view = new MarkdownView();
view.file = currentNote;
const app = Object.assign(new App(), {
    vault: {
        config: { userIgnoreFilters: [] },
        getMarkdownFiles: () => vault.files,
        cachedRead: async (file: TFile) => {
            await nextTask();
            return vault.contents.get(file) as string;
        },
    },
    workspace: { getMostRecentLeaf: () => ({ view }) },
});
const engine = new SearchEngine(app as any, settings);
const search = engine.search.bind(engine);
engine.search = (query: string) => {
    const start = performance.now();
    const results = search(query);
    const stroke = keystrokes[keystrokes.length - 1];
    if (stroke && !stroke.handlerEnd) stroke.searchMs += performance.now() - start;
    return results;
};
const plugin = { settings, searchEngine: engine, mobileSession: undefined } as unknown as TheArchiveSearchPlugin;

const openTimes: number[] = [];
const inputLatencies: number[] = [];

/** One input event: when it was sent, when its handlers ran, when the frame after them painted. */
interface Keystroke {
    sentAt: number;
    handlerStart: number;
    handlerEnd: number;
    /** Time inside engine.search during the handlers. */
    searchMs: number;
    paintedAt: number;
    value: string;
}

let keystrokes: Keystroke[] = [];
/** When the latest key went down. The input event it causes is stamped when it fires, so it cannot show queueing. */
let keyDownAt = 0;
document.addEventListener('keydown', (event) => {
    keyDownAt = event.timeStamp;
}, true);

const openButton = document.body.createEl('button', { cls: 'perf-open', text: 'Search' });
openButton.addEventListener('click', (event) => {
    const tappedAt = event.timeStamp;
    new MobileSearchModal(app as any, plugin).open();
    void afterNextFrame().then((paintedAt) => openTimes.push(paintedAt - tappedAt));
});

document.addEventListener('input', (event) => {
    const typedAt = keyDownAt || event.timeStamp;
    const stroke: Keystroke = {
        sentAt: typedAt,
        handlerStart: performance.now(),
        handlerEnd: 0,
        searchMs: 0,
        paintedAt: 0,
        value: (event.target as HTMLInputElement).value,
    };
    keystrokes.push(stroke);
    void afterNextFrame().then((paintedAt) => {
        stroke.paintedAt = paintedAt;
        inputLatencies.push(paintedAt - typedAt);
    });
}, true);
document.addEventListener('input', () => {
    keystrokes[keystrokes.length - 1].handlerEnd = performance.now();
});

const harness = {
    vaultStats: () => ({ notes: vault.files.length, totalChars: vault.totalChars }),

    startRecording(): void {
        frames = [];
        keystrokes = [];
        recordStart = performance.now();
        recording = true;
        requestAnimationFrame(frameLoop);
    },

    async stopRecording() {
        await afterNextFrame();
        recording = false;
        const end = performance.now();
        const tasks = longTasks.filter((task) => task.start >= recordStart && task.start < end);
        const intervals = frames.slice(1).map((time, i) => time - frames[i]);
        const strokes = keystrokes.splice(0);
        return {
            windowMs: end - recordStart,
            keystrokes: strokes,
            longTasks: tasks.map((task) => Math.round(task.duration)),
            frameIntervals: intervals.map((interval) => Math.round(interval * 10) / 10),
            openToPaintMs: openTimes.splice(0),
            inputToPaintMs: inputLatencies.splice(0),
        };
    },

    async buildIndex() {
        const start = performance.now();
        await engine.buildIndex();
        return { indexMs: performance.now() - start, indexed: engine.search('').length };
    },

    /** The match count the modal should show for `query`, straight from the engine. */
    expectedCount: (query: string) => engine.search(query).length,

    /** Median, min and max ms of `engine.search(query)` over `iterations` runs, after a warmup. */
    benchSearch(queries: string[], iterations: number) {
        return queries.map((query) => {
            let matches = 0;
            for (let i = 0; i < 3; i++) matches = engine.search(query).length;
            const times: number[] = [];
            for (let i = 0; i < iterations; i++) {
                const start = performance.now();
                matches = engine.search(query).length;
                times.push(performance.now() - start);
            }
            times.sort((a, b) => a - b);
            return { query, matches, medianMs: times[times.length >> 1], minMs: times[0], maxMs: times[times.length - 1] };
        });
    },

    state: () => ({
        rowsInDom: document.querySelectorAll('.mobile-search-row').length,
        matchCount: document.querySelector('.mobile-search-match-count')?.textContent ?? '',
        inputFocused: document.activeElement?.classList.contains('mobile-search-input') ?? false,
        query: (document.querySelector('.mobile-search-input') as HTMLInputElement | null)?.value ?? '',
    }),

    /** Scroll the result list away from the thumb by `pxPerFrame` each frame for `ms`. */
    async scrollList(pxPerFrame: number, ms: number): Promise<void> {
        const list = document.querySelector('.mobile-search-results') as HTMLElement;
        const start = performance.now();
        while (performance.now() - start < ms) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            list.scrollTop -= pxPerFrame;
        }
    },

    /** Scroll to the far end until no more rows arrive; the list must then hold every row. */
    async scrollToEnd() {
        const list = document.querySelector('.mobile-search-results') as HTMLElement;
        let stable = 0;
        let count = -1;
        while (stable < 5) {
            list.scrollTop = -list.scrollHeight;
            await afterNextFrame();
            const now = document.querySelectorAll('.mobile-search-row').length;
            stable = now === count ? stable + 1 : 0;
            count = now;
        }
        return count;
    },

    /** Shrink the visual viewport to `keyboardHeight` over `ms`, one step per frame. */
    async raiseKeyboard(keyboardHeight: number, ms: number): Promise<void> {
        const full = window.innerHeight;
        const start = performance.now();
        for (;;) {
            const time = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
            const progress = Math.min(1, (time - start) / ms);
            viewport.height = Math.round(full - keyboardHeight * (1 - (1 - progress) ** 3));
            viewport.dispatchEvent(new Event('resize'));
            if (progress === 1) return;
        }
    },
};

(window as any).perfHarness = harness;
