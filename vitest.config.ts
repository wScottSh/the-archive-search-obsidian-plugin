import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

export default defineConfig({
    test: {
        alias: {
            obsidian: fileURLToPath(new URL('./tests/__mocks__/obsidian.ts', import.meta.url)),
        },
    },
});
