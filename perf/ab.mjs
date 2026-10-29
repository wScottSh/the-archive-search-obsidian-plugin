/**
 * A/B the perf harness: the working tree against a git ref, one run of each
 * side per round, alternating which goes first, so drift and other load on
 * the machine land on both sides alike.
 *
 *   npm run perf:ab -- --base <ref> [--rounds 5] [--throttle 10] [--vault <dir>] [--app-css <file>] [--save name]
 *
 * The ref must already have the fast-typing harness. Prints median [min-max]
 * per side; --save writes perf/results/<name>.json.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? fallback : process.argv[i + 1];
}

const base = arg('base', 'HEAD');
const rounds = Number(arg('rounds', 5));
const throttle = arg('throttle', '10');
const vault = arg('vault', undefined);
const appCss = arg('app-css', undefined);
const save = arg('save', undefined);

const git = (...args) => execFileSync('git', args, { cwd: root }).toString().trim();
const baseCommit = git('rev-parse', '--short', base);
const baseDir = path.join(os.tmpdir(), `archive-search-ab-${baseCommit}`);
if (!existsSync(baseDir)) {
    git('worktree', 'add', '--detach', baseDir, baseCommit);
    symlinkSync(path.join(root, 'node_modules'), path.join(baseDir, 'node_modules'));
}

const METRICS = [
    ['fastType', 'lastKeyToFinalPaintMs'],
    ['fastType', 'worstKeyToPaintMs'],
    ['fastType', 'totalHandlerMs'],
    ['fastType', 'totalSearchMs'],
    ['fastType', 'longTaskTotalMs'],
    ['fastDelete', 'lastKeyToFinalPaintMs'],
    ['fastDelete', 'worstKeyToPaintMs'],
    ['fastDelete', 'totalHandlerMs'],
    ['fastDelete', 'totalSearchMs'],
    ['fastDelete', 'longTaskTotalMs'],
    ['type', 'worstKeyToPaintMs'],
    ['open', 'tapToPaintMs'],
    ['bench', 'search_b'],
    ['bench', 'search_blah'],
    ['bench', 'search_e'],
];

function runOnce(dir) {
    const args = ['perf/run.mjs', '--runs', '1', '--throttle', throttle, '--save', '_ab'];
    if (vault) args.push('--vault', vault);
    if (appCss) args.push('--app-css', path.resolve(appCss));
    execFileSync('node', args, { cwd: dir, stdio: 'ignore' });
    const run = JSON.parse(readFileSync(path.join(dir, 'perf/results/_ab.json'), 'utf8')).runs[0];
    if (!run.fastType.correct || !run.fastDelete.correct) throw new Error(`wrong final list in ${dir}`);
    return run;
}

const sides = { base: { dir: baseDir, runs: [] }, head: { dir: root, runs: [] } };
for (let i = 0; i < rounds; i++) {
    const order = i % 2 ? ['head', 'base'] : ['base', 'head'];
    for (const side of order) sides[side].runs.push(runOnce(sides[side].dir));
    process.stdout.write(`round ${i + 1}/${rounds} done\n`);
}

function summarize(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return { median, min: sorted[0], max: sorted[sorted.length - 1] };
}

const round = (n) => (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
const show = ({ median, min, max }) => `${round(median)} [${round(min)}-${round(max)}]`;
const summary = {};
console.log(`\n${''.padEnd(34)}${`base ${baseCommit}`.padStart(22)}${'head (working tree)'.padStart(22)}`);
for (const [scenario, metric] of METRICS) {
    const key = `${scenario}.${metric}`;
    summary[key] = Object.fromEntries(Object.entries(sides).map(([side, { runs }]) => [side, summarize(runs.map((run) => run[scenario][metric] ?? NaN))]));
    console.log(`${key.padEnd(34)}${show(summary[key].base).padStart(22)}${show(summary[key].head).padStart(22)}`);
}

if (save) {
    const meta = {
        date: new Date().toISOString(),
        base: baseCommit,
        head: git('rev-parse', '--short', 'HEAD'),
        headDirty: git('status', '--porcelain', '--', 'src', 'main.ts') !== '',
        rounds,
        cpuThrottle: Number(throttle),
        vault: vault ?? 'synthetic',
        appCss: appCss ?? null,
        host: os.cpus()[0].model,
        loadAverage: os.loadavg(),
    };
    const file = path.join(root, 'perf/results', `${save}.json`);
    writeFileSync(file, JSON.stringify({ meta, summary, runs: { base: sides.base.runs, head: sides.head.runs } }, null, 2) + '\n');
    console.log(`\nsaved ${path.relative(process.cwd(), file)}`);
}
