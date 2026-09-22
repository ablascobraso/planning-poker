import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    // Forge serves the bundle from a hashed path, so every asset reference has to
    // be relative rather than rooted at "/".
    base: './',
    build: {
        outDir: 'build',
        emptyOutDir: true,
    },
});
