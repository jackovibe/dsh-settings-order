/**
 * Post-install end-to-end check for dsh-settings-order.
 *
 * Runs against the LIVE GUI with the plugin mounted by the profile (nothing is
 * injected here): the browser half must already be active, the host namespace
 * must receive the reordered ids, and a page reload must bring the order back
 * from the host — proving the order is not merely browser-local.
 *
 *   - the footer (controls + decorated rows) proves the plugin is live;
 *   - Alt+ArrowDown moves the focused row and lands in ~/.dsh/settings.yaml;
 *   - the footer's ↓ control moves the *active* page and lands there too;
 *   - a reload reapplies the host order;
 *   - a native HTML5 drag moves a row and lands there too;
 *   - reset restores the shell's own order and clears the stored list;
 *   - the workspace document is untouched.
 *
 * The check is non-destructive: it reads the user's stored order first, and
 * restores it at the end (through the same ↑/↓ controls it just verified).
 *
 * Usage: node e2e/settings-order-e2e.mjs [port]
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

const port = Number(process.argv[2] ?? 3080)
const home = homedir()
/**
 * The DSH home under check. Point `DSH_E2E_HOME` at a scratch home (see the
 * README) to verify against an isolated instance: nothing here then touches the
 * real `~/.dsh/settings.yaml`.
 */
const dshHome = process.env.DSH_E2E_HOME || join(home, '.dsh')
const settingsPath = join(dshHome, 'settings.yaml')
const workspacePath = join(dshHome, 'storages', 'workspace.json')

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

/** YAML plain/quoted scalar → value (only what the settings serializer emits here). */
function unquote(raw) {
  const text = raw.trim()
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'")
  return text
}

/** The `order:` list inside the top-level `settings-order:` block, or null. */
function hostOrder() {
  if (!existsSync(settingsPath)) return null
  const text = readFileSync(settingsPath, 'utf8')
  const block = text.match(/^settings-order:[ \t]*\r?\n((?:[ \t]+.*\r?\n?)*)/m)
  if (!block) return null
  const body = block[1]
  if (/^[ \t]*order:[ \t]*\[\][ \t]*\r?$/m.test(body)) return []
  return [...body.matchAll(/^[ \t]*-[ \t]*(.+?)[ \t]*\r?$/gm)].map((match) => unquote(match[1]))
}

/**
 * The settings document is persisted by the host's own writer, which may
 * coalesce writes — so wait for the file instead of assuming one round-trip is
 * enough, and report how long it took.
 */
async function waitForHostOrder(expected, timeoutMs = 20000) {
  const started = Date.now()
  for (;;) {
    const current = hostOrder()
    if (JSON.stringify(current) === JSON.stringify(expected)) return { ok: true, ms: Date.now() - started, current }
    if (Date.now() - started > timeoutMs) return { ok: false, ms: Date.now() - started, current }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/** The host's per-workspace session ids (the ordering this plugin must never touch). */
function workspaceSessionOrder(text) {
  const parsed = JSON.parse(text)
  const out = {}
  for (const [id, row] of Object.entries(parsed.tables?.workspaces ?? {})) {
    out[id] = Array.isArray(row.sessionIds) ? [...row.sessionIds] : []
  }
  return out
}

const before = {
  settings: existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : '',
  workspaces: existsSync(workspacePath) ? workspaceSessionOrder(readFileSync(workspacePath, 'utf8')) : null,
}
const report = { url, dshHome, steps: {}, storage: {}, console: [], pageErrors: [] }
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (message) => {
  const text = `${message.type()}: ${message.text()}`
  // Combo-bundle URLs list every plugin, so "dsh-settings-order" appears inside
  // unrelated warnings; only keep short, plugin-specific lines.
  if (text.length > 400) return
  if (/dsh-settings-order|settings-order:|Uncaught/i.test(text)) report.console.push(text)
})
page.on('pageerror', (error) => report.pageErrors.push(String(error)))

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

/**
 * The README illustration: the whole navigation column (title, rows, footer),
 * with a few pixels trimmed from the right edge so the neighbouring content
 * pane does not bleed into the crop. No session titles are involved.
 */
async function captureDocsShot() {
  const column = page.locator('[class*="_navList"]').locator('..')
  const box = await column.boundingBox()
  if (!box) return
  await page.screenshot({
    path: join(docsDir, 'settings-order.png'),
    clip: {
      x: box.x,
      y: box.y + 4,
      width: Math.max(120, box.width - 20),
      height: Math.max(80, box.height - 8),
    },
  })
}

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

function readNav() {
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
      return { id: key, active: cell.getAttribute('aria-current') === 'true', decorated: cell.dataset.dshsoCell === '1' }
    })
    const foot = document.querySelector('[data-dshso="foot"]')
    return {
      ids: rows.map((row) => row.id),
      decorated: rows.filter((row) => row.decorated).length,
      activeId: rows.find((row) => row.active)?.id ?? null,
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

function localOrder() {
  return page.evaluate(() => {
    try {
      return JSON.parse(window.localStorage.getItem('dsh.settings-order.nav') || 'null')
    } catch (error) {
      return null
    }
  })
}

/**
 * Walk one row to an exact position through its keyboard path: focus the row,
 * press Alt+Arrow. The footer's ↑/↓ act on the *active* page instead, which
 * makes them a poor fit for a scripted walk — an activation that does not take
 * silently moves a different row, and the walk ends on the wrong order.
 */
async function moveRowTo(id, index) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const nav = await readNav()
    const from = nav.ids.indexOf(id)
    if (from === -1) throw new Error(`row "${id}" vanished while restoring the order`)
    if (from === index) return
    await page.evaluate((at) => {
      const navList = document.querySelector('[class*="_navList"]')
      const cells = [...navList.children].filter((el) => el.matches && el.matches('[class*="_navCell"]'))
      cells[at].focus()
    }, from)
    await page.keyboard.press(from > index ? 'Alt+ArrowUp' : 'Alt+ArrowDown')
    await page.waitForTimeout(320)
    const after = await readNav()
    if (after.ids.indexOf(id) === index) return
  }
  throw new Error(`could not walk "${id}" to position ${index}`)
}

/** Restore an exact id order, verified position by position. */
async function restoreOrder(ids) {
  for (let index = 0; index < ids.length; index++) await moveRowTo(ids[index], index)
  const final = await readNav()
  if (JSON.stringify(final.ids) !== JSON.stringify(ids)) {
    throw new Error(`restore ended on the wrong order: ${final.ids.join(',')}`)
  }
}

try {
  const priorHostOrder = hostOrder()
  report.steps.priorHostOrder = priorHostOrder

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(2500)
  await openSettings()

  const initial = await readNav()
  report.steps.rowCount = initial.ids.length
  report.steps.initialOrder = initial.ids
  report.steps.initialFoot = initial.foot
  report.steps.decoratedRows = initial.decorated
  report.steps.pluginActive = Boolean(initial.foot) && initial.foot.up && initial.foot.down && initial.decorated === initial.ids.length && initial.decorated > 0
  if (!report.steps.pluginActive) throw new Error('the installed plugin did not decorate the Settings navigation (footer/rows missing)')
  report.steps.hostMatchesDomAtStart = Boolean(priorHostOrder) && JSON.stringify(priorHostOrder) === JSON.stringify(initial.ids)
  report.steps.localStorageUsedInHostMode = await localOrder()
  await captureDocsShot()
  await page.screenshot({ path: join(shotDir, 'e2e-01-installed.png') })

  //#region Alt+ArrowDown on the first row
  const firstId = initial.ids[0]
  await page.evaluate(() => {
    const navList = document.querySelector('[class*="_navList"]')
    const cell = [...navList.children].find((el) => el.matches && el.matches('[class*="_navCell"]'))
    cell.focus()
  })
  await page.keyboard.press('Alt+ArrowDown')
  await page.waitForTimeout(1100)
  const afterKey = await readNav()
  report.steps.afterAltDown = afterKey.ids
  report.steps.altSwapped = afterKey.ids[0] === initial.ids[1] && afterKey.ids[1] === firstId
  report.steps.hostOrderAfterAltDown = await waitForHostOrder(afterKey.ids)
  report.steps.hintRetiredAfterReorder = afterKey.foot?.hintHidden ?? null
  if (!report.steps.altSwapped) throw new Error('Alt+ArrowDown did not move the focused navigation row')
  if (!report.steps.hostOrderAfterAltDown.ok) {
    throw new Error('the reordered ids did not reach the host settings document: ' + JSON.stringify(report.steps.hostOrderAfterAltDown))
  }
  report.steps.hostWriteLatencyMs = report.steps.hostOrderAfterAltDown.ms
  await page.screenshot({ path: join(shotDir, 'e2e-02-after-alt.png') })
  //#endregion

  //#region footer ↓ control on the active row
  const targetIndex = 2
  const targetId = afterKey.ids[targetIndex]
  await page.locator('[class*="_navCell"]').nth(targetIndex).click()
  await page.waitForTimeout(400)
  const selected = await readNav()
  if (selected.activeId !== targetId) throw new Error('clicking a row did not make it the active page')
  report.steps.middleRowControlsEnabled = selected.foot.upDisabled === false && selected.foot.downDisabled === false
  await page.locator('[data-dshso="down"]').click()
  await page.waitForTimeout(1100)
  const afterDown = await readNav()
  report.steps.afterDownControl = afterDown.ids
  report.steps.downControlMovedActive = afterDown.ids[targetIndex + 1] === targetId && afterDown.ids[targetIndex] === selected.ids[targetIndex + 1]
  report.steps.hostOrderAfterDownControl = await waitForHostOrder(afterDown.ids)
  report.steps.resetOffered = afterDown.foot?.resetHidden === false
  if (!report.steps.downControlMovedActive) throw new Error('the ↓ control did not move the active page one place down')
  if (!report.steps.hostOrderAfterDownControl.ok) {
    throw new Error('the ↓ control did not reach the host settings document: ' + JSON.stringify(report.steps.hostOrderAfterDownControl))
  }
  if (!report.steps.resetOffered) throw new Error('the reset action did not appear after a custom order')
  await page.screenshot({ path: join(shotDir, 'e2e-03-after-controls.png') })
  //#endregion

  //#region reload: the host document must bring the order back
  const expected = afterDown.ids
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await openSettings()
  const reloaded = await readNav()
  report.steps.afterReload = reloaded.ids
  report.steps.reloadKeptOrder = JSON.stringify(reloaded.ids) === JSON.stringify(expected)
  report.steps.hostAfterReload = hostOrder()
  if (!report.steps.reloadKeptOrder) throw new Error('the host-stored order was not reapplied after a reload')
  await page.screenshot({ path: join(shotDir, 'e2e-04-after-reload.png') })
  //#endregion

  //#region native HTML5 drag
  const cells = page.locator('[class*="_navCell"]')
  const lastIndex = reloaded.ids.length - 1
  const lastId = reloaded.ids[lastIndex]
  await cells.nth(lastIndex).dragTo(cells.nth(0), { targetPosition: { x: 40, y: 2 } })
  await page.waitForTimeout(1300)
  const afterDrag = await readNav()
  report.steps.afterDrag = afterDrag.ids
  report.steps.dragMovedLastToFirst = afterDrag.ids[0] === lastId
  report.steps.hostOrderAfterDrag = await waitForHostOrder(afterDrag.ids)
  if (!report.steps.dragMovedLastToFirst) throw new Error('the native drag did not move the row')
  if (!report.steps.hostOrderAfterDrag.ok) {
    throw new Error('the dragged ids did not reach the host settings document: ' + JSON.stringify(report.steps.hostOrderAfterDrag))
  }
  await page.screenshot({ path: join(shotDir, 'e2e-05-after-drag.png') })
  //#endregion

  //#region reset, then restore the user's own order
  await page.locator('[data-dshso="reset"]').click()
  await page.waitForTimeout(1300)
  const afterReset = await readNav()
  report.steps.afterReset = afterReset.ids
  report.steps.resetClearedHost = (await waitForHostOrder([])).ok
  report.steps.resetHidItself = afterReset.foot?.resetHidden === true
  if (!report.steps.resetClearedHost) throw new Error('reset did not clear the stored order')
  if (!report.steps.resetHidItself) throw new Error('reset did not retire its own action')

  if (priorHostOrder && priorHostOrder.length > 0) {
    report.steps.builtInOrder = afterReset.ids
    await restoreOrder(priorHostOrder)
    await page.waitForTimeout(600)
    const restored = await readNav()
    report.steps.restoredDom = restored.ids
    report.steps.restoredHost = await waitForHostOrder(priorHostOrder)
    report.steps.orderRestored = JSON.stringify(restored.ids) === JSON.stringify(priorHostOrder)
    if (!report.steps.orderRestored) {
      report.warning = 'the user order was NOT restored; click 恢复默认 / reorder manually (see restoredDom)'
    }
  } else {
    report.steps.orderRestored = true
  }
  //#endregion
} catch (error) {
  report.failure = String(error)
  try {
    await page.screenshot({ path: join(shotDir, 'e2e-99-failure.png') })
  } catch (shotError) {
    report.failureScreenshot = String(shotError)
  }
} finally {
  await browser.close()
}

const afterWorkspaces = existsSync(workspacePath) ? workspaceSessionOrder(readFileSync(workspacePath, 'utf8')) : null
report.storage = {
  workspaceOrderUntouched:
    before.workspaces === null || afterWorkspaces === null
      ? null
      : JSON.stringify(afterWorkspaces) === JSON.stringify(before.workspaces),
  hostOrderAtEnd: hostOrder(),
  settingsNamespaceBlock: existsSync(settingsPath)
    ? (readFileSync(settingsPath, 'utf8').match(/^settings-order:[\s\S]{0,400}/m) ?? [null])[0]
    : null,
}
writeFileSync(join(shotDir, 'e2e-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (report.failure) process.exit(1)
