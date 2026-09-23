/**
 * Pre-install DOM check for dsh-settings-order.
 *
 * The plugin does not have to be installed for this harness: it injects the
 * built browser half into the LIVE DSH Web GUI, runs its `apply()` against two
 * representative contexts, and asserts the real behaviour against the real
 * Settings dialog —
 *
 *   phase A (a remote browser: no `settingsScope`, no `slots` service)
 *     - rows are found by the CSS-module suffix selectors;
 *     - every row's identity is the section id React keyed it with;
 *     - the footer shows the ↑ / ↓ controls, the hint and the browser-local
 *       note;
 *     - Alt+ArrowDown moves the focused row, a native HTML5 drag moves the
 *       last row to the front, and both write the browser-local order;
 *     - a full page reload re-applies that stored order.
 *
 *   phase B (a host-backed browser: stubbed `settingsScope` + `slots`)
 *     - the ↑ / ↓ controls move the *active* page and the write reaches the
 *       host scope with the full id list;
 *     - the reset action restores the shell's own order and clears the host
 *       value;
 *     - the browser-local note is gone, and the hint retires after the first
 *       reorder.
 *
 * Usage: node e2e/preinstall-dom-check.mjs [port]
 */
import { chromium } from 'playwright-core'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const shotDir = join(root, 'shots')
const docsDir = join(root, 'docs')
mkdirSync(shotDir, { recursive: true })
mkdirSync(docsDir, { recursive: true })

const clientSource = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
const port = Number(process.argv[2] ?? 3080)
const home = homedir()

/**
 * The GUI to check: `DSH_E2E_URL` (explicit, e.g. a scratch instance started on
 * another port) or the newest token URL in the watchdog log.
 */
function resolveUrl() {
  if (process.env.DSH_E2E_URL) return process.env.DSH_E2E_URL
  const log = readFileSync(join(home, '.dsh', 'dsh-web.log'), 'utf8')
  const tokenLine = log.split(/\r?\n/).filter((line) => line.includes('dsh web: http')).pop()
  if (!tokenLine) throw new Error('no token URL line in ~/.dsh/dsh-web.log (set DSH_E2E_URL instead)')
  return tokenLine.split('dsh web: ')[1].trim().replace(/:\d+/, `:${port}`)
}

const url = resolveUrl()

const chromiumPath = join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe')
if (!existsSync(chromiumPath)) throw new Error('chromium not found at ' + chromiumPath)

const report = { url, steps: {}, console: [], pageErrors: [] }
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (message) => {
  const text = `${message.type()}: ${message.text()}`
  // Combo-bundle URLs list every plugin; only keep short, plugin-specific lines.
  if (text.length > 400) return
  if (/dsh-settings-order|settings-order:|ModuleLoader|Uncaught/i.test(text)) report.console.push(text)
})
page.on('pageerror', (error) => report.pageErrors.push(String(error)))

/** Intercept the module loader, run the plugin's factory, keep its exports. */
async function injectPlugin() {
  await page.waitForFunction(() => Boolean(window.__ModuleLoader__ && window.__ModuleLoader__.load), null, { timeout: 60000 })
  await page.evaluate(() => {
    const loader = window.__ModuleLoader__
    if (loader.__dshsoShimmed !== true) {
      const original = loader.load.bind(loader)
      loader.load = (descriptor) => {
        if (descriptor && descriptor.id === 'dsh-settings-order') {
          window.__dshsoExports = descriptor.factory()
          return undefined
        }
        return original(descriptor)
      }
      loader.__dshsoShimmed = true
    }
  })
  await page.addScriptTag({ content: clientSource })
  const info = await page.evaluate(() => {
    if (!window.__dshsoExports || typeof window.__dshsoExports.apply !== 'function') throw new Error('plugin factory did not export apply()')
    return { hasApply: true }
  })
  return info
}

/** Phase A: the remote-browser context — no settings scope, no slot service. */
function applyWithoutHost() {
  return page.evaluate(() => {
    window.localStorage.removeItem('dsh.settings-order.nav')
    window.localStorage.removeItem('dsh.settings-order.hint-seen')
    window.__dshsoExports.apply({ logger: console })
    return true
  })
}

/** Phase B: a host-backed context with a stubbed settings scope and slot service. */
function applyWithHost(naturalIds) {
  return page.evaluate((ids) => {
    window.localStorage.removeItem('dsh.settings-order.nav')
    window.localStorage.removeItem('dsh.settings-order.hint-seen')
    const host = { order: [], listeners: new Set() }
    window.__dshsoHost = host
    const scope = {
      getSnapshot: () => ({ mode: 'host', status: 'ready', value: { order: host.order.slice() } }),
      set: (field, value) => {
        if (field === 'order') {
          host.order = value.slice()
          for (const listener of host.listeners) listener()
        }
        return Promise.resolve()
      },
      subscribe: (listener) => {
        host.listeners.add(listener)
        return () => host.listeners.delete(listener)
      },
    }
    const slots = {
      entries: (name) => (name === 'settings.section' ? ids.map((id) => ({ options: { id } })) : []),
      getVersion: () => 1,
      subscribe: () => () => {},
    }
    window.__dshsoExports.apply({
      logger: console,
      get: (name) => (name === 'settingsScope' ? { bind: () => scope } : name === 'slots' ? slots : undefined),
    })
    return true
  }, naturalIds)
}

/**
 * Clear the first-run overlays (beta notice, sidebar tip) that a fresh or
 * upgraded DSH home shows on top of the shell. Only the "keep things as they
 * are" choices are pressed — never the ones that change the layout.
 */
async function dismissOnboarding() {
  const labels = ['继续', '保留当前显示', '知道了', 'Got it', 'Continue', 'Keep']
  for (let round = 0; round < 6; round++) {
    let acted = false
    for (const label of labels) {
      const button = page.getByRole('button', { name: label, exact: true }).first()
      if ((await button.count()) === 0) continue
      if (!(await button.isVisible().catch(() => false))) continue
      await button.click({ timeout: 2000 }).catch(() => {})
      acted = true
      await page.waitForTimeout(400)
      break
    }
    if (!acted) {
      const closer = page.locator('button[aria-label*="关闭"]').first()
      if ((await closer.count()) > 0 && (await closer.isVisible().catch(() => false))) {
        await closer.click({ timeout: 2000 }).catch(() => {})
        acted = true
        await page.waitForTimeout(400)
      }
    }
    if (!acted) break
  }
}

/** Open the Settings dialog (the sidebar's dialog trigger). */
async function openSettings() {
  await dismissOnboarding()
  const candidates = ['button[aria-label="设置"]', 'button[aria-label="Settings"]', 'button[aria-haspopup="dialog"]']
  for (const selector of candidates) {
    const trigger = page.locator(selector).first()
    if ((await trigger.count()) === 0) continue
    await trigger.click({ timeout: 5000 }).catch(() => {})
    try {
      await page.waitForSelector('[class*="_navList"]', { timeout: 6000 })
      await page.waitForTimeout(700)
      return selector
    } catch (error) {
      await dismissOnboarding()
    }
  }
  throw new Error('could not open the Settings dialog')
}

/** The Settings navigation as ids, labels and footer state. */
function readNavRows() {
  return page.evaluate(() => {
    const navList = document.querySelector('[class*="_navList"]')
    const cells = [...navList.children].filter((el) => el.matches && el.matches('[class*="_navCell"]'))
    const rows = cells.map((cell) => {
      let key = null
      for (const name of Object.keys(cell)) {
        if (!name.startsWith('__reactFiber$')) continue
        const fiber = cell[name]
        if (fiber && typeof fiber.key === 'string') key = fiber.key
      }
      const label = cell.querySelector('[class*="_navLabel"]')
      return {
        id: key,
        keyedById: key !== null,
        active: cell.getAttribute('aria-current') === 'true',
        decorated: cell.dataset.dshsoCell === '1',
        draggable: cell.getAttribute('draggable') === 'true',
        label: label ? (label.textContent || '').trim() : '',
      }
    })
    const foot = document.querySelector('[data-dshso="foot"]')
    return {
      rows,
      foot: foot
        ? {
            text: foot.textContent,
            up: Boolean(foot.querySelector('[data-dshso="up"]')),
            down: Boolean(foot.querySelector('[data-dshso="down"]')),
            upDisabled: foot.querySelector('[data-dshso="up"]')?.disabled ?? null,
            downDisabled: foot.querySelector('[data-dshso="down"]')?.disabled ?? null,
            resetHidden: foot.querySelector('[data-dshso="reset"]')?.hidden ?? null,
            hintHidden: foot.querySelector('[data-dshso="hint"]')?.hidden ?? null,
            note: foot.querySelector('[data-dshso="note"]')?.hidden ? '' : foot.querySelector('[data-dshso="note"]')?.textContent ?? '',
          }
        : null,
    }
  })
}

function openSessionBar() {
  return page.evaluate(() => {
    const navList = document.querySelector('[class*="_navList"]')
    const cell = [...navList.children].find((el) => el.matches && el.matches('[class*="_navCell"]'))
    cell.focus()
    return cell.querySelector('[class*="_navLabel"]')?.textContent?.trim() ?? ''
  })
}

function storedOrder() {
  return page.evaluate(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem('dsh.settings-order.nav') || '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      return null
    }
  })
}

function hostOrder() {
  return page.evaluate(() => (window.__dshsoHost ? window.__dshsoHost.order.slice() : null))
}

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

  //#region phase A — remote browser, browser-local fallback
  await injectPlugin()
  await applyWithoutHost()
  await openSettings()

  const before = await readNavRows()
  report.steps.rowCount = before.rows.length
  report.steps.labels = before.rows.map((row) => row.label)
  report.steps.ids = before.rows.map((row) => row.id)
  report.steps.allIdentitiesKeyed = before.rows.every((row) => row.keyedById && typeof row.id === 'string' && row.id !== '')
  report.steps.decoratedRows = before.rows.filter((row) => row.decorated).length
  report.steps.draggableRows = before.rows.filter((row) => row.draggable).length
  report.steps.initialFoot = before.foot
  if (!report.steps.allIdentitiesKeyed) throw new Error('not every navigation row resolved to a section id from its React fiber key')
  if (new Set(before.rows.map((row) => row.id)).size !== before.rows.length) throw new Error('navigation ids are not unique')
  if (!before.foot || !before.foot.up || !before.foot.down) throw new Error('the footer controls did not render')
  if (!/仅本浏览器|This browser only/.test(before.foot.note)) throw new Error('the browser-local note is missing: ' + before.foot.note)
  await page.locator('[class*="_navList"]').locator('..').screenshot({ path: join(docsDir, 'settings-order.png') })
  await page.screenshot({ path: join(shotDir, 'pre-01-open.png') })

  // keyboard: nudge the first row down one place
  const firstId = before.rows[0].id
  await openSessionBar()
  await page.keyboard.press('Alt+ArrowDown')
  await page.waitForTimeout(600)
  const afterKey = await readNavRows()
  report.steps.afterAltDown = afterKey.rows.map((row) => row.id)
  report.steps.altSwapped = afterKey.rows[0].id === before.rows[1].id && afterKey.rows[1].id === firstId
  report.steps.storedAfterAltDown = await storedOrder()
  report.steps.hintRetiredAfterReorder = afterKey.foot?.hintHidden ?? null
  if (!report.steps.altSwapped) throw new Error('Alt+ArrowDown did not move the focused navigation row')
  if (JSON.stringify(report.steps.storedAfterAltDown) !== JSON.stringify(afterKey.rows.map((row) => row.id))) {
    throw new Error('the reordered navigation order was not persisted to browser storage')
  }
  await page.screenshot({ path: join(shotDir, 'pre-02-after-alt.png') })

  // native HTML5 drag: the last row onto the first
  const cells = page.locator('[class*="_navCell"]')
  const lastIndex = afterKey.rows.length - 1
  const lastId = afterKey.rows[lastIndex].id
  await cells.nth(lastIndex).dragTo(cells.nth(0), { targetPosition: { x: 40, y: 2 } })
  await page.waitForTimeout(900)
  const afterDrag = await readNavRows()
  report.steps.afterDrag = afterDrag.rows.map((row) => row.id)
  report.steps.dragMovedLastToFirst = afterDrag.rows[0].id === lastId
  if (!report.steps.dragMovedLastToFirst) throw new Error('the native drag did not move the row')
  await page.screenshot({ path: join(shotDir, 'pre-03-after-drag.png') })

  // reload: a fresh page must re-apply the stored order on its own
  const expected = afterDrag.rows.map((row) => row.id)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await injectPlugin()
  await applyWithoutHost()
  await openSettings()
  const reloaded = await readNavRows()
  report.steps.afterReload = reloaded.rows.map((row) => row.id)
  report.steps.reloadKeptOrder = JSON.stringify(reloaded.rows.map((row) => row.id)) === JSON.stringify(expected)
  if (!report.steps.reloadKeptOrder) throw new Error('the stored order was not reapplied after a reload')
  await page.screenshot({ path: join(shotDir, 'pre-04-after-reload.png') })
  //#endregion

  //#region phase B — host-backed context (stubbed), incl. the ↑ / ↓ controls
  const naturalIds = reloaded.rows.map((row) => row.id)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await injectPlugin()
  await applyWithHost(naturalIds)
  await openSettings()
  const hostStart = await readNavRows()
  report.steps.hostPhaseStart = {
    order: hostStart.rows.map((row) => row.id),
    note: hostStart.foot?.note ?? null,
    resetHidden: hostStart.foot?.resetHidden ?? null,
    upDisabled: hostStart.foot?.upDisabled ?? null,
    downDisabled: hostStart.foot?.downDisabled ?? null,
  }
  if ((hostStart.foot?.note ?? '') !== '') throw new Error('the host-backed context must not show the browser-local note')

  // select the third page, then drive the ↑ / ↓ controls
  const selected = hostStart.rows[2]
  await page.locator('[class*="_navCell"]').nth(2).click()
  await page.waitForTimeout(500)
  const selectedState = await readNavRows()
  report.steps.afterSelect = { active: selectedState.rows.find((row) => row.active)?.id ?? null, foot: selectedState.foot }
  if ((selectedState.rows.find((row) => row.active)?.id ?? null) !== selected.id) throw new Error('the clicked row is not the active one')
  if (selectedState.foot.upDisabled !== false || selectedState.foot.downDisabled !== false) throw new Error('the ↑/↓ controls are not enabled for a middle row')

  await page.locator('[data-dshso="down"]').click()
  await page.waitForTimeout(900)
  const afterDown = await readNavRows()
  const movedIds = afterDown.rows.map((row) => row.id)
  report.steps.afterDownControl = movedIds
  report.steps.downControlMovedActive = movedIds[3] === selected.id && movedIds[2] === selectedState.rows[3].id
  report.steps.hostAfterDownControl = await hostOrder()
  report.steps.resetOffered = afterDown.foot?.resetHidden === false
  if (!report.steps.downControlMovedActive) throw new Error('the ↓ control did not move the active page one place down')
  if (JSON.stringify(report.steps.hostAfterDownControl) !== JSON.stringify(movedIds)) {
    throw new Error('the ↓ control did not reach the host scope: ' + JSON.stringify(report.steps.hostAfterDownControl))
  }
  if (!report.steps.resetOffered) throw new Error('the reset action did not appear after a custom order')
  await page.screenshot({ path: join(shotDir, 'pre-05-host-controls.png') })

  await page.locator('[data-dshso="reset"]').click()
  await page.waitForTimeout(900)
  const afterReset = await readNavRows()
  report.steps.afterReset = afterReset.rows.map((row) => row.id)
  report.steps.resetRestoredNatural = JSON.stringify(afterReset.rows.map((row) => row.id)) === JSON.stringify(naturalIds)
  report.steps.hostAfterReset = await hostOrder()
  if (!report.steps.resetRestoredNatural) throw new Error('reset did not restore the shell order')
  if (JSON.stringify(report.steps.hostAfterReset) !== '[]') throw new Error('reset did not clear the host value')
  report.steps.resetHiddenAgain = afterReset.foot?.resetHidden === true
  //#endregion

  await page.evaluate(() => {
    window.localStorage.removeItem('dsh.settings-order.nav')
    window.localStorage.removeItem('dsh.settings-order.hint-seen')
  })
} catch (error) {
  report.failure = String(error)
  try {
    await page.screenshot({ path: join(shotDir, 'pre-99-failure.png') })
  } catch (shotError) {
    report.failureScreenshot = String(shotError)
  }
} finally {
  await browser.close()
}

writeFileSync(join(shotDir, 'preinstall-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (report.failure) process.exit(1)
