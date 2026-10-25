// PROTOTYPE — dev server for the mobile search UI prototype. `npm run prototype:mobile`
import esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import os from 'os';

const here = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT) || 5188;

const ctx = await esbuild.context({
    entryPoints: [here + 'main.ts'],
    bundle: true,
    outdir: here + 'out',
    format: 'esm',
    target: 'es2020',
    sourcemap: 'inline',
    alias: { obsidian: here + 'obsidian-shim.ts' },
    logLevel: 'info',
});
await ctx.watch();
await ctx.serve({ host: '0.0.0.0', port, servedir: here });

const lan = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
console.log(`\nMobile search prototype:\n${lan.map((ip) => `  http://${ip}:${port}/?variant=A`).join('\n')}\n`);
