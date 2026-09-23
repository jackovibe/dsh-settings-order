# Notice

`dsh-settings-order` is an independent local plugin written for this machine's
DeepSeek Harness Web profile (DSH 0.1.5-rc.x).

The browser half uses the same *technique* as other DSH sidebar/DOM plugins
(`dsh-pin` by Yu-tao-Li, MIT; `dsh-codex-pin`, MIT): a MutationObserver-driven
overlay that identifies React-owned rows from their fiber (`__reactFiber$…`,
`fiber.key`) and decorates them with plain DOM. No code was copied from those
plugins — only the pattern (fiber-keyed row identity, debounced observer +
interval fallback, host settings namespace with a browser-local fallback) is
shared, and all of it is applied here to the Settings navigation instead of the
session list.

It also relies on two DSH internals that are not public API:

- the CSS-module class suffixes of the Settings shell (`_navList`, `_navCell`,
  `_navLabel`), matched with `[class*="…"]` because the hashed prefix changes
  between builds;
- the shell's row key (the `settings.section` entry id) being readable from the
  row button's React fiber.

If a future DSH build renames those suffixes, the plugin fails soft: it finds no
rows and changes nothing.

No DSH source file is modified by this plugin; it is mounted as an ordinary
profile plugin through its own bundle patch.
