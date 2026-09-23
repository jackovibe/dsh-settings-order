/**
 * dsh-settings-order client bundle builder.
 *
 * Copies the plain-script browser half `src/client-src.js` to the served bundle
 * `lib/client.js` and fails the build when the result has a syntax error.
 *
 * Usage:
 *   node scripts/build-client.mjs          # (re)write lib/client.js
 *   node scripts/build-client.mjs --check  # fail if the checked-in bundle drifted
 */
import { readFileSync, writeFileSync } from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const src = readFileSync(join(root, 'src', 'client-src.js'), 'utf8')

try {
  new vm.Script(src, { filename: 'client.js' })
} catch (error) {
  console.error('build-client: src/client-src.js has a syntax error:', error.message)
  process.exit(1)
}

const target = join(root, 'lib', 'client.js')
if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8')
  if (current !== src) {
    console.error('build-client --check: lib/client.js is stale. Run `npm run build`.')
    process.exit(1)
  }
  console.log('build-client: lib/client.js is in sync with src/client-src.js')
} else {
  writeFileSync(target, src)
  console.log(`build-client: wrote ${target} (${src.length} bytes)`)
}
