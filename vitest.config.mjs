import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The backend's Forge packages (storage, realtime, Jira API) only work inside
// Forge, so tests swap them for in-memory fakes with the same exports (see
// test/fakes). The resolvers themselves run unchanged.
const fake = (name) => fileURLToPath(new URL(`./test/fakes/${name}.js`, import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            '@forge/api': fake('api'),
            '@forge/kvs': fake('kvs'),
            '@forge/realtime': fake('realtime'),
        },
    },
    test: {
        include: ['test/**/*.test.js'],
    },
});
