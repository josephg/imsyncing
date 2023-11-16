import { build } from 'esbuild'
import { solidPlugin } from 'esbuild-plugin-solid'
import fs from 'fs'

// of type BuildOptions.
const options = {
  entryPoints: ['web/index.tsx'],
  bundle: true,
  // minify: true,
  logLevel: 'info',
  sourcemap: true,
  outfile: 'public/bundle.js',
  metafile: true,
  tsconfig: 'web/tsconfig.json',
  plugins: [solidPlugin({
    solid: {
      generate: 'dom',
      hydratable: false,
    }
  })],
}

;(async () => {
  const result = await build(options)
  fs.writeFileSync('esbuild-meta.json', JSON.stringify(result.metafile))

  // And also minify, to see the file size difference.
  const minResult = await build({
    ...options,
    minify: true,
    outfile: 'public/bundle.min.js',
  })
  // fs.writeFileSync('esbuild-meta.json', JSON.stringify(result.metafile))
})()