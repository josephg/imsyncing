import { build } from 'esbuild'
import { solidPlugin } from 'esbuild-plugin-solid'
import fs from 'fs'

;(async () => {
  const result = await build({
    entryPoints: ['web/index.tsx'],
    bundle: true,
    minify: true,
    logLevel: 'info',
    sourcemap: true,
    outfile: 'public/bundle.js',
    metafile: true,
    plugins: [solidPlugin({
      solid: {
        generate: 'dom',
        hydratable: false,
      }
    })],
  })

  fs.writeFileSync('esbuild-meta.json', JSON.stringify(result.metafile))
})()