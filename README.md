# dsh-settings-order

[![ci](https://github.com/jackovibe/dsh-settings-order/actions/workflows/ci.yml/badge.svg)](https://github.com/jackovibe/dsh-settings-order/actions/workflows/ci.yml)

**Free ordering for the Settings navigation in the DeepSeek Harness Web GUI.**
Drag a page, press `Alt+↑`/`Alt+↓`, or use the footer's `↑`/`↓` controls — the
order is stored on the host, so it survives restarts and follows you to every
browser the transport reaches.

```
设置
 ↑ ↓ 恢复默认
 归档会话        ← dragged up from the bottom
 通用设置
 模型
 插件
 插件市场
 …
```

![the Settings navigation with the reorder controls](docs/settings-order.png)

## Why this exists

The Settings dialog's left column is rendered from the shell's
`settings.section` list slot, and SlotCore keeps list entries **sorted by
`priority` then by the registering plugin's own `order`**. That is a build-time
decision by each plugin — the shell exposes no drag, no sort control, no
preference, and there is no supported way to change it from user space.

This plugin leaves the slot registry alone (no re-registration, no order
override, no `order` patching of other packages). It reorders the rows that are
already rendered, and remembers the result.

## What you get

| | |
| --- | --- |
| **Drag** | grab any row and drop it where you want (an insertion mark shows the landing slot) |
| **Keyboard** | focus a row and press `Alt+↑` / `Alt+↓` |
| **Footer controls** | `↑` / `↓` move the page you are currently viewing one place — the touch-friendly path, since a phone browser has no mouse drag and no `Alt` key |
| **Reset** | once your order differs from the built-in one, a `恢复默认` / `Reset` action returns it |
| **Host-persisted** | the list lives in `~/.dsh/settings.yaml` under `settings-order.order`, shared by every browser that can reach host settings |
| **Browser-local fallback** | a browser the transport cannot reach (some remote setups) keeps its own `localStorage` copy and says so in the footer |
| **Fail-soft** | if a future DSH build changes the markup, the plugin changes nothing and shows `无法识别设置项` in the footer instead of failing silently |
| **Non-destructive** | third-party pages (`archived-sessions`, `market`, `cost-meter`, …) reorder exactly like built-ins; a page added later keeps the position the shell gives it; ids that no longer exist are ignored |

Nothing else is touched: no session or workspace ordering, no other plugin's
DOM, no slot registrations, no model-visible input, no network.

## Install

Requirements: a DSH install with the Web GUI (verified on **0.1.6-alpha.2**, and
it also runs on 0.1.5-rc.x) plus a profile to install into (`web` in the commands
below). Nothing is built at install time — the client bundle ships ready to serve,
so a plain `dsh plugin add` is enough.

```powershell
# from GitHub (tracks `main`)
dsh plugin --profile web add github:jackovibe/dsh-settings-order

# pin a released version instead
dsh plugin --profile web add github:jackovibe/dsh-settings-order#v0.2.0

# or from a local checkout / tarball
npm pack
dsh plugin --profile web add .\dsh-settings-order-0.2.0.tgz
```

`dsh plugin add` records the dependency **and** appends it to
`dsh.profile.bundles`, which is what mounts it — the package carries its own
bundle patch, so **never** add a second `insert` for it in the profile's
`cordis.patch.yml` (a duplicate loader id would break startup).

Then restart `dsh web`: the host half registers the settings namespace at boot,
and the profile's client bundles are served from a boot-time snapshot, so a page
refresh alone is not enough. Open **设置 / Settings** — the navigation column now
gains a footer with `↑` / `↓`, the hint line and (once you reorder) `恢复默认`.

### Update

```powershell
dsh plugin --profile web up dsh-settings-order   # re-resolve the dependency
```

Restart `dsh web` when the new release changed the client half
(`lib/client.js`); a docs-only release does not need it.

## Usage

1. Open **设置 / Settings**.
2. Reorder however you like: drag a row, or select a page and press `↑` / `↓`
   in the footer (or `Alt+↑` / `Alt+↓` on a focused row).
3. The order is saved immediately; the footer's `恢复默认` / `Reset` appears
   once your order differs from the built-in one. The one-line hint retires
   after your first reorder.

## Storage

`~/.dsh/settings.yaml`:

```yaml
settings-order:
  order:
    - general
    - archived-sessions
    - plugins
```

Browser-local fallback (`localStorage`): `dsh.settings-order.nav` (the ordered
ids), `dsh.settings-order.hint-seen` (the hint flag).

## How it works

* **Rows are found by CSS-module suffix** — `[class*="_navList"]`,
  `[class*="_navCell"]`, `[class*="_navLabel"]`. The hashed prefix
  (`VOzbGW_…`) changes between builds; the suffixes do not.
* **Row identity is the React key.** The shell keys each row button with its
  `settings.section` entry id, so the fiber's `key` *is* the id the host stores.
  An unreadable fiber falls back to the row's label text.
* **Reorder = move the existing nodes** inside their own parent
  (`navList.appendChild` in the target order). Nothing is re-created, so React
  keeps ownership; a `MutationObserver` re-applies the saved order whenever the
  shell re-renders the list.
* **The built-in order** (for `Reset`) is read live from
  `ctx.slots.entries('settings.section')`, which SlotCore keeps sorted by
  `priority` then `order`.
* **Writes are optimistic**: the local order is applied immediately and kept
  until the host echoes it back, so a slow round-trip never flickers.

`npm test` pins all of the above — selectors, the row key, the slot ordering —
against the *installed* DSH, so an upgrade that breaks them fails the test suite
rather than the user's Settings dialog.

## Verification

```powershell
npm run check   # the served bundle is the built source
npm test        # static invariants + the installed host contract
npm run e2e:dom # inject the browser half into a live GUI and exercise it
npm run e2e     # against the installed plugin: host persistence, reset, drag, reload
```

`e2e/preinstall-dom-check.mjs` works **before** the plugin is installed: it injects
the built browser half into the running GUI, runs `apply()` twice — once with no
settings scope (the browser-local/remote path) and once against a stubbed host
scope — and asserts row identities, `Alt+↓`, a native HTML5 drag, persistence,
the footer's `↑`/`↓` controls and reset, and that a full page reload re-applies
the stored order. `e2e/settings-order-e2e.mjs` runs against the **installed**
plugin, snapshots the host order first and restores it afterwards.

Both harnesses take the GUI from `DSH_E2E_URL`, or else from the newest token URL
in `~/.dsh/dsh-web.log`; the settings/workspace documents come from
`DSH_E2E_HOME`, or else `~/.dsh`. They need `playwright-core` and a reachable
`dsh web`.

### Verifying against an isolated home

Prefer a scratch instance that owns its own home: the settings document is
persisted by the instance that owns it, and a *second* instance sharing `~/.dsh`
accepts the change in memory but does not rewrite `settings.yaml` (observed on
0.1.6). Isolating the home also keeps your real settings out of the test.

```powershell
$home2 = Join-Path (Get-Location) '.scratch-home'   # inside the repo, git-ignored
New-Item -ItemType Directory $home2 -Force | Out-Null
New-Item -ItemType Junction "$home2\profiles" "$env:USERPROFILE\.dsh\profiles"   # reuse the installed profile
$env:DSH_HOME = $home2
dsh web --no-open --port 3099          # prints its own token URL
# then, in another shell:
$env:DSH_E2E_URL = 'http://127.0.0.1:3099/?token=…'
$env:DSH_E2E_HOME = $home2
node e2e/settings-order-e2e.mjs 3099
```

A fresh home shows the first-run overlays (beta notice, sidebar tip); the
harnesses dismiss them by pressing only the "keep things as they are" choices.
`shots/` is git-ignored — those captures are full-window and contain real
session titles; only the dialog-side crop in `docs/settings-order.png` ships.

## Remove

```powershell
dsh plugin --profile web remove dsh-settings-order
# and drop "dsh-settings-order" from dsh.profile.bundles, then restart dsh web
```

`scripts/rollback.ps1` does both steps and restarts the server through the
watchdog.

## Compatibility

Verified against DSH **0.1.6-alpha.2** (and written for 0.1.5-rc.x, whose
Settings shell has the same markup and slot contract). `npm test` skips the host
contract block when no DSH install is found; point `DSH_CORE_ROOT` at the
`@deepseek-ai` scope directory to check a specific build.

## Development

```powershell
node scripts/build-client.mjs          # src/client-src.js → lib/client.js
node scripts/build-client.mjs --check  # fail when the bundle is stale
node --test                            # contract + invariants
```

Layout: `lib/index.js` (host half: the settings namespace), `src/client-src.js`
(browser half, plain script), `lib/client.js` (served bundle), `cordis.patch.yml`
(the bundle patch), `e2e/`, `test/`, `scripts/`, `docs/`.

## Privacy

`shots/` is git-ignored on purpose: those screenshots are full-window captures
of a live GUI and contain real session titles. The screenshot in this README is
a dialog-only crop.

## License

MIT — see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
