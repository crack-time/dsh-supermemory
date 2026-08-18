// tsdown client bundle protocol (mirrors DSH packages/client/tsdown.client.ts):
// input  = lib/client/index.js (tsc client program output)
// output = lib/client.js (CJS closure-factory, window.__ModuleLoader__.load format)
import { defineConfig } from 'tsdown'

export default defineConfig({
  name: '@crack/dsh-supermemory/client',
  entry: { client: 'lib/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  // react is a platform module: the browser ModuleLoader resolves it from the
  // frozen module table (dsh-client-web/src/platform), never bundled.
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  dts: false,
  sourcemap: true,
  clean: false,
  minify: false,
  hash: false,
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "@crack/dsh-supermemory", factory: (require) => {',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
})
