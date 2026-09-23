# Changelog

All notable changes to `dsh-settings-order` are documented here. The format
loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses semantic versioning.

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
