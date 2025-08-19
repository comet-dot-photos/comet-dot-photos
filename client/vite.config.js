// client/vite.config.js
import { defineConfig } from 'vite';

export default defineConfig(({ mode, command }) => {
  const isDev = mode === 'development';
  const isBuild = command === 'build'; // 'build' or 'serve'
  const isDevBuild = isDev && isBuild;

  return {
    root: 'src',
    base: '/',
    resolve: { dedupe: ['three'] },
    build: {
      outDir: '../dist',
      emptyOutDir: true,
      assetsInlineLimit: 0,
      sourcemap: isDev ? 'inline' : 'hidden', // examples: dev maps inline, prod hidden
      minify: isBuild ? 'esbuild' : false,
      chunkSizeWarningLimit: isDevBuild ? 5000 : 1000,
    }
  };
});

