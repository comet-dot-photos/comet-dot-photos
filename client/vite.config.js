import { defineConfig } from 'vite';

export default defineConfig(({ mode, command }) => {
  const isDev = mode === 'development';
  const isBuild = command === 'build';

  return {
    root: 'src',
    base: '/',
    resolve: { dedupe: ['three'] },

    build: {
      outDir: '../dist',
      emptyOutDir: true,
      assetsInlineLimit: 0,

      // Dev: inline maps for convenience; Prod: external .map files
      sourcemap: isDev ? 'inline' : true,

      minify: isBuild ? 'esbuild' : false,
      chunkSizeWarningLimit: isDev ? 5000 : 1000,

      // (Optional) ensure sources are included in maps (default is true)
      rollupOptions: {
        output: {
          // sourcemapExcludeSources: false // uncomment if you ever changed it elsewhere
        }
      }
    },

    // (Optional) CSS maps in dev only; prod CSS maps follow build.sourcemap
    css: {
      devSourcemap: isDev
    }
  };
});