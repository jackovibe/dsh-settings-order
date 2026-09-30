/**
 * Host-contract test for dsh-settings-order.
 *
 * The plugin lives on three DSH internals that are not public API:
 *
 *   1. the Settings shell's CSS-module class suffixes (`_navList`, `_navCell`,
 *      `_navLabel`) — matched with `[class*="…"]` because the hashed prefix
 *      changes between builds;
 *   2. the row key: the shell keys each row button with its `settings.section`
 *      entry id, which is what the fiber's `key` exposes;
 *   3. `ctx.slots.entries('settings.section')` returning list entries sorted by
 *      priority then `order` (the "reset to built-in order" target).
 *
 * If any of them changes, the plugin can only degrade — so each one is pinned
 * here, and `npm test` fails loudly instead of the Settings dialog silently
 * refusing to reorder. DSH internals are read from the *installed* host; when
 * no host is present the contract block skips with a note (set `DSH_CORE_ROOT`
 * to the `@deepseek-ai` scope directory).
 *
 * The final block pins the plugin's Config contract and, when an installed
 * host is found, checks the schema-derived SettingsForms API it targets.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const src = read('src/client-src.js')

//#region our own contract with those internals
test('the browser half identifies rows from the shell\u2019s markup, not from a slot mutation', () => {
  assert.match(src, /NAV_LIST_SELECTOR = '\[class\*="_navList"\]'/, 'the navigation list selector must stay suffix-based')
  assert.match(src, /NAV_CELL_SELECTOR = '\[class\*="_navCell"\]'/, 'the row selector must stay suffix-based')
  assert.match(src, /LABEL_SELECTOR = '\[class\*="_navLabel"\]'/, 'the label selector is the identity fallback')
  assert.ok(
    !/slots\.(register|inject)\s*\(/.test(src),
    'the plugin must never register or inject slots — reordering is a DOM-layer concern',
  )
  assert.ok(
    !/insertSessionBefore|insertWorkspaceBefore/.test(src),
    'reordering the Settings navigation must not touch session or workspace order',
  )
})

test('row identity comes from the fiber key with a label fallback, and never from position alone', () => {
  assert.match(src, /__reactFiber\$/, 'row identity rides the React fiber')
  assert.match(src, /fiber\.key/, 'the shell keys each row by its section id')
  assert.match(src, /'label:' \+ text/, 'an unreadable fiber must fall back to the rendered label')
  assert.match(src, /ACTIVE_ATTRIBUTE = 'aria-current'/, 'the ↑/↓ controls act on the row the shell marks active')
})

test('the built-in order target is read from the settings.section list slot', () => {
  assert.match(src, /slots\.entries\('settings\.section'\)/, 'the reset target is the slot\u2019s own entry order')
  assert.match(src, /naturalKnown/, 'an unreachable slot service must disable reset instead of guessing')
})

test('every internal dependency degrades visibly instead of silently', () => {
  assert.match(src, /unreadable:/, 'unidentifiable rows need a user-visible diagnosis')
  assert.match(src, /writeFailed:/, 'a rejected host write needs a user-visible diagnosis')
  assert.match(src, /diagnosis/, 'diagnoses are rendered in the footer')
  assert.match(src, /local:/, 'the browser-local fallback must say so')
})

test('the browser half reaches host settings through configForms, with the legacy scope as fallback', () => {
  assert.match(src, /serviceOf\('configForms'\)/, 'DSH 0.1.7 carries preferences through the configForms service')
  assert.match(src, /forms\.get\(NAMESPACE\)/, 'the 0.1.7 form is addressed by the loader entry id')
  assert.match(src, /serviceOf\('settingsScope'\)/, 'older hosts keep the legacy settings scope')
  assert.match(src, /legacy\.bind\(\{ namespace: NAMESPACE \}\)/, 'the legacy transport binds by namespace')
  assert.match(src, /typeof form\.set === 'function'/, 'an unusable form must fall through instead of throwing')
})

test('a Host refusal reported as a resolved false is not treated as a saved order', () => {
  assert.match(src, /accepted === false/, 'the 0.1.7 form resolves false on a refused write')
  assert.match(src, /function refuse\(list\)/, 'a refusal keeps the gesture effective and diagnoses itself')
  assert.match(src, /diagnosis = T\.writeFailed/, 'a refusal must be visible in the footer')
})

test('all three interaction paths exist: drag, Alt+Arrow and the footer controls', () => {
  assert.match(src, /addEventListener\('dragstart'/, 'drag')
  assert.match(src, /\(event\.key !== 'ArrowUp' && event\.key !== 'ArrowDown'\)/, 'keyboard')
  assert.match(src, /makeButton\('up'/, 'the ↑ control')
  assert.match(src, /makeButton\('down'/, 'the ↓ control')
  assert.match(src, /makeButton\('reset'/, 'the reset control')
})
//#endregion

//#region installed host
const CORE_CANDIDATES = [
  process.env.DSH_CORE_ROOT,
  process.env.APPDATA
    ? join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai')
    : undefined,
  process.env.DSH_PROFILE
    ? join(process.env.DSH_PROFILE, 'node_modules', '@deepseek-ai')
    : undefined,
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai',
  '/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai',
].filter((dir) => typeof dir === 'string' && dir.length > 0)

/** The `@deepseek-ai` scope directory of an installed DSH, or null. */
function findCoreRoot() {
  for (const dir of CORE_CANDIDATES) {
    if (existsSync(join(dir, 'dsh-client-ui-settings-general', 'package.json'))) return dir
  }
  return null
}

/** The DSH Web shell bundle (its name is content-hashed) that carries SlotCore. */
function findShellBundle(core) {
  const assets = join(core, 'dsh-web-frontend', 'dist', 'assets')
  if (!existsSync(assets)) return null
  for (const name of readdirSync(assets)) {
    if (!name.endsWith('.js')) continue
    const text = readFileSync(join(assets, name), 'utf8')
    if (text.includes('SlotCore')) return text
  }
  return null
}

const core = findCoreRoot()

if (core === null) {
  test('host contract', (t) => {
    t.skip('no DSH core found — set DSH_CORE_ROOT to the @deepseek-ai scope directory')
  })
} else {
  const shell = readFileSync(join(core, 'dsh-client-ui-settings-general', 'lib', 'client.js'), 'utf8')
  const settingsTypesPath = join(core, 'dsh-settings', 'lib', 'types', 'index.d.ts')
  const settingsTypes = existsSync(settingsTypesPath) ? readFileSync(settingsTypesPath, 'utf8') : ''

  test('the installed host exposes schema-derived SettingsForms for plugin Config', (t) => {
    if (!settingsTypes.includes('class SettingsForms extends Service')) {
      t.skip('installed host predates schema-derived SettingsForms')
      return
    }
    assert.match(settingsTypes, /describe\(options\?: SettingsDescribeOptions\): SettingsDescriptor\[\]/)
    assert.match(settingsTypes, /update\(ns: string, patch: object/)
    assert.ok(!settingsTypes.includes('register(ns:'), 'the removed namespace registration API must not be assumed')
  })

  test('the Settings shell still renders the navigation with the suffixes we select on', () => {
    for (const suffix of ['_navList', '_navCell', '_navLabel']) {
      assert.ok(shell.includes(suffix), `the Settings shell no longer renders ${suffix} — the plugin would find no rows`)
    }
    assert.match(shell, /"settings\.section":\s*\{\s*kind:\s*"list"/, 'settings.section must stay a list slot')
  })

  test('each row is still keyed by its section id and marked active with aria-current', () => {
    assert.match(
      shell,
      /navCell[\s\S]{0,1200}?\},\s*row\.id\)\)/,
      'the row button must keep row.id as its React key — that key is the plugin\u2019s identity',
    )
    assert.match(shell, /aria-current[^\n]{0,80}row\.id === active/, 'the active row marker drives the ↑/↓ controls')
  })

  test('the shell still reads the section list from the slot service', () => {
    assert.match(shell, /ctx\.slots\.entries\("settings\.section"\)/, 'the shell\u2019s row order is the slot entry order')
    assert.match(shell, /ctx\.slots\.getVersion\("settings\.section"\)/, 'the row list is versioned by the slot ledger')
  })

  test('SlotCore still sorts list entries by priority then order (the reset target)', () => {
    const bundle = findShellBundle(core)
    if (bundle === null) {
      assert.ok(false, 'no shell bundle carrying SlotCore found under dsh-web-frontend/dist/assets')
      return
    }
    assert.match(
      bundle,
      /kind\s*===\s*"list"\s*\?[^;]{0,200}options\.order/,
      'list slots must stay ordered by options.order, or the built-in order is no longer defined',
    )
  })
}

const host = read('lib/index.js')

test('the host exports an editable volatile Config for schema-derived SettingsForms', () => {
  assert.match(host, /export const name = 'settings-order'/)
  assert.match(host, /export const Config = z\.object\(\{/)
  assert.match(host, /order: z\.array\(z\.string\(\)\)\.default\(\[\]\)\.volatile\(\)/)
})

test('the host avoids the removed register API but preserves legacy compatibility', () => {
  assert.match(host, /typeof settings\.register === 'function'/)
  assert.match(host, /settings\.register\(name, Config/)
})
//#endregion
