/**
 * Static invariants for dsh-settings-order.
 *
 * These are the properties that must hold in the repository itself, whatever
 * the host build looks like: the served bundle is the built source, the shipped
 * file list is complete, the bundle patch mounts exactly one loader row, the
 * browser half writes nothing but this plugin's own preference, and the docs
 * describe the version that is actually in `package.json`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const pkg = JSON.parse(read('package.json'))
const src = read('src/client-src.js')
const bundle = read('lib/client.js')
const host = read('lib/index.js')
const patch = read('cordis.patch.yml')
const readme = read('README.md')
const readmeZh = read('README.zh-CN.md')
const changelog = read('CHANGELOG.md')

test('the served bundle is the built source, and it parses', () => {
  assert.equal(bundle, src, 'lib/client.js drifted from src/client-src.js — run `npm run build`')
  assert.doesNotThrow(() => new vm.Script(bundle, { filename: 'lib/client.js' }), 'the browser half must be a valid plain script')
})

test('the browser half is a module-loader script, not a host module', () => {
  assert.match(bundle, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(bundle, /id: 'dsh-settings-order'/)
  assert.match(bundle, /exports\.apply = apply/)
  assert.ok(!/^\s*import\s/m.test(bundle), 'the client half must not use ESM imports — it is served as a plain script')
  assert.ok(!/^\s*export\s/m.test(bundle), 'the client half must not use ESM exports')
})

test('the browser half stays inert: no dynamic code, no markup injection, one preference', () => {
  assert.ok(!/\beval\s*\(/.test(src), 'no eval')
  assert.ok(!/new Function/.test(src), 'no dynamic Function construction')
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(src), 'no markup injection')
  assert.ok(!/document\.write/.test(src))
  const writes = [...src.matchAll(/\b(?:bound|scope)\.set\(([^)]*)\)/g)].map((match) => match[1].trim())
  assert.deepEqual(writes, ["'order', saved"], 'the only host write is this plugin\u2019s own ordered list')
  const localKeys = [...src.matchAll(/localStorage\.setItem\(([A-Z_]+),/g)].map((match) => match[1])
  assert.deepEqual(localKeys, ['STORAGE_KEY', 'HINT_KEY'], 'the browser-local store holds the order and the hint flag, nothing else')
})

test('the bundle patch mounts exactly one loader row', () => {
  const ids = [...patch.matchAll(/^\s*-\s*id:\s*(\S+)\s*$/gm)].map((match) => match[1])
  assert.deepEqual(ids, ['settings-order'], 'the patch must insert a single row with a stable id')
  assert.match(patch, /name:\s*dsh-settings-order/)
})

test('the host half registers only the settings-order namespace', () => {
  assert.match(host, /export const name = 'settings-order'/)
  assert.match(host, /export const inject = \['settings'\]/)
  assert.match(host, /ctx\.settings\.register\('settings-order'/)
  assert.match(host, /order: z\.array\(z\.string\(\)\)\.default\(\[\]\)/)
  assert.match(host, /applies: 'live'/)
})

test('package metadata is publishable and points at the public repository', () => {
  assert.equal(pkg.name, 'dsh-settings-order')
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  assert.equal(pkg.license, 'MIT')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.main, './lib/index.js')
  assert.ok(pkg.private !== true, 'the package is published, so it must not be private')
  assert.match(pkg.repository.url, /github\.com\/jackovibe\/dsh-settings-order\.git$/)
  assert.ok(Array.isArray(pkg.keywords) && pkg.keywords.includes('dsh-plugin'))
  assert.match(pkg.engines.node, />=/)
  for (const script of ['build', 'check', 'test', 'e2e']) assert.ok(pkg.scripts[script], `missing script ${script}`)
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
})

test('the shipped file list covers every artefact the plugin needs', () => {
  for (const entry of ['lib', 'src', 'scripts', 'e2e', 'test', 'docs', 'cordis.patch.yml', 'README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE.md']) {
    assert.ok(pkg.files.includes(entry), `package.json files is missing ${entry}`)
    assert.ok(existsSync(join(root, entry)), `${entry} is listed in files but does not exist`)
  }
})

test('the docs describe the version and the repository that ship here', () => {
  assert.ok(changelog.includes(`## [${pkg.version}]`), 'CHANGELOG has no entry for the released version')
  for (const text of [readme, readmeZh]) {
    assert.ok(text.includes(pkg.name), 'the README must name the package')
    assert.ok(text.includes('jackovibe/dsh-settings-order'), 'the README must point at the public repository')
    assert.ok(text.includes('dsh plugin --profile web add'), 'the README must carry the install command')
  }
  assert.match(readme, /## Verification/)
  assert.ok(!/0\.1\.0/.test(readme) || pkg.version === '0.1.0', 'the README must not advertise a stale version')
})
