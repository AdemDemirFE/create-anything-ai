import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['resources/js/**/*.test.ts', 'resources/js/**/*.test.tsx'],
    },
    resolve: {
        alias: {
            '@shared': new URL('../../shared/src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
        },
    },
});
