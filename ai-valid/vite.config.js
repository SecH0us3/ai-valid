import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
    },
    assetsInclude: ['**/*.html', '**/*.css', '**/*.svg', '**/*.png', '**/*.txt', '**/*.json']
});
