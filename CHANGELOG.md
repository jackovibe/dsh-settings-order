# Changelog

All notable changes to `dsh-settings-order` are documented here. The format
loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses semantic versioning.

## [0.2.1] — 2026-09-23

Four interaction-layer defects: a rejected host write used to lose the gesture,
a disposing plugin left live listeners behind, fast repeats inside the 50 ms sync
window dropped moves, and label-fallback ids could reach the host namespace.

### Fixed

- **A rejected host write no longer rolls the rows back.** The write used to be
  adopted by the browser-local copy and then silently overwritten by the host's
  stale value once the 5-second echo window closed; the reorder simply vanished.
  A failure now marks the order as `pendingLocal`, and `refresh()` refuses to
  adopt any host value that does not match it — so the rejected write stays
  effective (and the footer no longer claims a browser-local store the plugin
  never reads back) until the host echoes the order it was actually given.
- **Dispose now removes the navigation list's listeners and binding marker.**
  `decorate()` bound six listeners (`dragstart` / `dragover` / `dragleave` /
  `drop` / `dragend` / `keydown`) and set `data-dshso-bound` on the shell's
  `_navList`, but the `ctx.effect` cleanup only removed the row markers. After a
  plugin disable or reload the old closure kept handling drags and Alt+Arrow on
  the same node — and could write through a dead scope. The list is now
  remembered in `boundList` and fully unbound (listeners plus marker) on
  dispose.
- **Rapid `↑` / `↓` presses (or a held `Alt+Arrow`) no longer lose moves.** Both
  keyboard paths computed the next order from the DOM order (`nav.ids`), which
  only catches up 50 ms later when `sync()` reapplies the order. Any second press
  inside that window read a stale list and re-applied its own arithmetic on top
  of it — losing a move, or moving the wrong row. Both paths now shift relative
  to the logical order (`desiredOrder(nav)`), which already contains the pending
  gesture.
- **Label-fallback ids are never persisted.** `cellId()` falls back to
  `label:<text>` when a row's React fiber is unreadable — an identity that is
  display-only: it is not a `settings.section` id, so writing it to the host
  namespace poisoned the saved list (and the fallback text changes with the
  language). `commit()` now refuses any list containing a `label:` id, and the
  footer keeps saying `无法识别设置项` while such a row is present, so the
  degradation is visible instead of silent — and it self-heals as soon as the
  row becomes identifiable again.

### Known issues

Tracked for a later release; none of them loses data on their own:

- `reset` is unreachable while the `slots` service is not available
  (`naturalKnown` stays false), so the built-in order cannot be restored.
- The `writeFailed` and `scopeUnbound` diagnoses are sticky: they only clear on
  the next `commit()`, not when the host recovers by itself.
- The 5-second echo window can still flicker against a host that echoes slower
  than that (the row briefly returns, then re-applies the saved order).
- A drop trusts the `dropAt` captured by the last `dragover`, so a drop after
  the rows moved under the pointer can target a stale neighbor.
- `Alt+Arrow` at the first/last row does not `preventDefault()`, so the shell's
  own key handling still sees that key.
- When `ctx.effect` is missing the plugin registers no cleanup at all (no
  listeners, DOM markers or footer are removed).
- A selector mismatch (a shell rename of `_navList` / `_navCell`) is still
  silent: no rows means no footer, hence no diagnosis line.
- A transient `getSnapshot()` failure flashes the list back to the last good
  value before the next successful read.
- `dragId` can outlive its row: if the drag source is removed mid-drag, the
  stale id is only cleared by the next `dragend` / dispose.

## [0.2.0] — 2026-09-23

Touch/remote support, visible degradation, and a test suite that pins the DSH
internals this plugin stands on.

### Added

- **Footer `↑` / `↓` controls** that move the page you are currently viewing
  one place. A phone or remote browser has neither a mouse drag nor an `Alt`
  key, so those controls are the only workable path there — and they double as
  a discoverable alternative on the desktop.
- **`恢复默认` / `Reset`** action in the footer, offered only once the order
  differs from the shell's own. The built-in order is read live from
  `ctx.slots.entries('settings.section')`; when that slot service is not
  reachable the action stays hidden instead of guessing.
- **Diagnoses in the footer** for the two failure modes that used to be silent:
  rows the plugin cannot identify (`无法识别设置项 (DSH 结构变化？)`) and a
  rejected host write (`保存失败，仅本浏览器生效`).
- `test/contract.test.mjs` — pins the shell's `_navList` / `_navCell` /
  `_navLabel` suffixes, the row key (`row.id`), the active-row marker
  (`aria-current`), and SlotCore's `priority`-then-`order` list sort against the
  *installed* DSH, and imports the installed host half to check the namespace.
  Skips with a note when no DSH install is present (`DSH_CORE_ROOT` overrides).
- `test/invariants.test.mjs` — the served bundle is the built source, the patch
  mounts exactly one loader row, the browser half writes only `order` to the
  host and only its own two keys to `localStorage`, and the docs match the
  shipped version.
- `.github/workflows/ci.yml` — GitHub Actions on every push and pull request:
  `npm run check` (the served bundle is its own source) plus `npm test`, on Node
  22 and 24, with no install step because both scripts use Node built-ins only.
  The READMEs carry the badge; `.gitignore`, `README.zh-CN.md` and this changelog
  came with it.
- Tagged `v0.2.0` with a GitHub release, and both READMEs now document the
  pinned install (`…dsh-settings-order#v0.2.0`), the requirements, what a
  successful install looks like on screen, and how to update.

### Changed

- **The one-line hint retires** after the first successful reorder
  (`localStorage: dsh.settings-order.hint-seen`) instead of occupying the
  navigation footer forever.
- The footer became a compact control row plus one hint line, replacing the
  three-line hint block.
- `package.json` gained `repository`, `keywords`, `engines`, the test/e2e
  scripts and the published file list, and is no longer `private`.

### Fixed

- A row whose React fiber is unreadable no longer disables the whole feature
  silently: identity falls back to the row's label text, and the failure is
  reported in the footer.
- The e2e suite no longer misreads a quoted YAML scalar
  (`"@weibaohui/skills-management"`) as a failed host write, and no longer
  treats session-list churn in `workspace.json` as an ordering side effect.
  `e2e/settings-order-e2e.mjs` now snapshots the host order before it runs and
  restores it afterwards, so running it never rewrites the user's own order.
- The host-write assertions **poll** `settings.yaml` instead of trusting one
  fixed sleep, and report how long the write took (4–7 ms on a local instance).
  A second `dsh web` sharing an existing `~/.dsh` accepts the change in memory
  but never rewrites the file — which looked like a plugin failure until the
  harness was pointed at an instance that owns its home.
- Both harnesses now dismiss the first-run overlays (beta notice, sidebar tip)
  before reaching for the Settings trigger, so they also run against a fresh
  `DSH_HOME`; the console filter ignores combo-bundle URL dumps that merely
  mention the plugin's name; the README illustration is captured as a
  dialog-side crop (`docs/settings-order.png`) instead of a full-window shot.
- The e2e order restore now walks each row through its **keyboard** path (focus
  the row, `Alt+Arrow`) and verifies every position, instead of clicking the
  footer controls: those act on the *active* page, so an activation that did not
  take moved a different row and left the restored order subtly wrong. The walk
  fails loudly when it cannot reach the requested order.
- No hard-coded local paths ship any more: the ops scripts derive the repository
  root from `$PSScriptRoot` (with a `-Root` override) and the README's
  scratch-home recipe is relative, so the published tree carries no
  author-machine layout — in the working tree *or* in history.

## [0.1.0] — 2026-09-16

### Added

- First release: drag, `Alt+↑` / `Alt+↓`, a `恢复默认` action, host-namespace
  persistence (`settings-order.order`) with a `localStorage` fallback, and the
  `e2e/preinstall-dom-check.mjs` harness that injects the browser half into a
  live GUI. Verified end to end on DSH 0.1.5-rc.x.
