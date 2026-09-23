// SPDX-License-Identifier: MIT
/**
 * Browser half of dsh-settings-order — free ordering for the Settings dialog's
 * left navigation column.
 *
 * The Settings shell renders that column from its `settings.section` list slot
 * (SlotCore keeps list entries sorted by priority then `order`), so the built-in
 * position of every page is fixed by the plugin that registers it and the shell
 * exposes no user-facing way to change it. This plugin does not touch the slot
 * registry (no re-registration, no order override); it reorders the already
 * rendered rows in the DOM and remembers the result:
 *
 * - drag any row to move it (HTML5 drag, with an insertion mark), or
 * - press Alt+↑ / Alt+↓ on a focused row, or
 * - use the ↑ / ↓ controls in the footer, which move the *currently selected*
 *   page and are the only workable path on touch devices (a remote/phone
 *   browser has neither a mouse drag nor an Alt key);
 * - the resulting order lives in the host `settings-order` settings namespace,
 *   so it survives restarts and reaches every browser the transport covers; a
 *   browser the transport cannot reach degrades to its own localStorage and
 *   says so in the footer;
 * - the footer also carries a `reset` action back to the shell's own order and
 *   a one-line hint (retired once the user has reordered something).
 *
 * Rows are React-owned, so the layer is deliberately observer-driven: it
 * reapplies the saved order whenever the shell re-renders the list (a plugin
 * registering a new section, the dialog reopening), and it never fights React
 * for node ownership — it only moves rows inside their existing parent.
 *
 * Every dependency on DSH internals is fail-soft and diagnosed on screen
 * instead of failing silently:
 * - row identity comes from the React fiber's `key` (the section id the shell
 *   keyed the row with), with the row's label text as a fallback;
 * - if a row cannot be identified at all, nothing is reordered and the footer
 *   says so, because the shell's markup changed under us;
 * - a rejected host write leaves the browser-local copy in place and shows an
 *   error note.
 */
window.__ModuleLoader__.load({
	id: 'dsh-settings-order',
	factory: () => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		//#region constants
		/** Host settings namespace carrying the ordered id list. */
		const NAMESPACE = 'settings-order';
		/** Browser-local fallback key for the same list. */
		const STORAGE_KEY = 'dsh.settings-order.nav';
		/** Browser-local flag: the user has reordered at least once (hint retires). */
		const HINT_KEY = 'dsh.settings-order.hint-seen';
		/**
		 * The Settings shell's navigation markup is CSS-module scoped, so the
		 * hashed prefix changes between builds while the `_navList` / `_navCell` /
		 * `_navLabel` suffixes stay stable.
		 */
		const NAV_LIST_SELECTOR = '[class*="_navList"]';
		const NAV_CELL_SELECTOR = '[class*="_navCell"]';
		const LABEL_SELECTOR = '[class*="_navLabel"]';
		/** The shell marks the page it is showing with `aria-current="true"`. */
		const ACTIVE_ATTRIBUTE = 'aria-current';
		const CSS = `
[data-dshso-cell="1"]{cursor:grab}
[data-dshso-cell="1"][data-dshso-dragging="1"]{opacity:.5;cursor:grabbing}
[data-dshso-cell="1"][data-dshso-drop="before"]{box-shadow:inset 0 2px 0 0 var(--dsw-alias-state-business-primary,#4f8cff)}
[data-dshso-cell="1"][data-dshso-drop="after"]{box-shadow:inset 0 -2px 0 0 var(--dsw-alias-state-business-primary,#4f8cff)}
.dshso-foot{display:flex;flex-direction:column;gap:4px;padding:0 12px;color:var(--dsw-alias-label-tertiary,#8b929c);font-size:11px;line-height:16px;user-select:none}
.dshso-controls{display:flex;align-items:center;gap:4px}
.dshso-btn{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;color:var(--dsw-alias-label-secondary,#b8bbc2);background:transparent;border:1px solid var(--dsw-alias-border-l2,#4b4d52);border-radius:6px;font:inherit;font-size:12px;line-height:1;cursor:pointer}
.dshso-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary,#fff);background:var(--dsw-alias-interactive-bg-hover,#3a3b3f)}
.dshso-btn:disabled{opacity:.4;cursor:not-allowed}
.dshso-btn[hidden]{display:none}
.dshso-hint,.dshso-note{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshso-hint[hidden],.dshso-note[hidden]{display:none}
.dshso-note[data-tone="error"]{color:var(--dsw-alias-state-error-primary,#ff6464)}
`;
		//#endregion

		//#region small helpers
		/** Whether the page's language is Chinese. */
		function isZh() {
			return /zh/i.test(document.documentElement.lang || navigator.language || '');
		}

		/** Report one non-fatal problem without breaking the page. */
		function warn(ctx, message) {
			if (ctx && ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn('dsh-settings-order: ' + message);
		}

		/** The React fiber attached to a DOM node (the shell's React instance). */
		function reactFiber(el) {
			for (const key of Object.keys(el)) if (key.startsWith('__reactFiber$')) return el[key];
			return null;
		}

		/**
		 * One navigation row's durable identity. The shell keys each row button by
		 * its section id, so the fiber key is exactly the id the host namespace
		 * stores; a row whose fiber is unreadable falls back to its label text.
		 */
		function cellId(cell) {
			const fiber = reactFiber(cell);
			if (fiber && typeof fiber.key === 'string' && fiber.key !== '') return fiber.key;
			const label = cell.querySelector(LABEL_SELECTOR);
			const text = label === null || label.textContent === null ? '' : label.textContent.trim();
			return text === '' ? null : 'label:' + text;
		}

		/** Element-wise array equality for id lists. */
		function sameOrder(left, right) {
			if (left.length !== right.length) return false;
			for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
			return true;
		}

		/**
		 * The saved order first (restricted to rows that still exist, deduplicated),
		 * then every remaining row in the order the shell rendered it — so a section
		 * added after the user last reordered lands where the shell put it.
		 */
		function mergeOrder(saved, current) {
			const merged = [];
			for (const id of saved) if (current.indexOf(id) !== -1 && merged.indexOf(id) === -1) merged.push(id);
			for (const id of current) if (merged.indexOf(id) === -1) merged.push(id);
			return merged;
		}
		//#endregion

		//#region plugin
		function apply(ctx) {
			const T = isZh()
				? {
					hint: '拖动或用 ↑↓ 调整顺序',
					up: '把当前设置页上移一位',
					down: '把当前设置页下移一位',
					reset: '恢复默认',
					resetTitle: '恢复内置顺序',
					local: '仅本浏览器（宿主设置不可达）',
					unreadable: '无法识别设置项（DSH 结构变化？）',
					writeFailed: '保存失败，仅本浏览器生效',
				}
				: {
					hint: 'Drag, or use ↑↓ to reorder',
					up: 'Move the current page up one place',
					down: 'Move the current page down one place',
					reset: 'Reset',
					resetTitle: 'Restore the built-in order',
					local: 'This browser only (host settings unreachable)',
					unreadable: 'Cannot identify the entries (DSH markup changed?)',
					writeFailed: 'Save failed; this browser only',
				};

			const style = document.createElement('style');
			style.dataset.plugin = 'dsh-settings-order';
			style.textContent = CSS;
			(document.head || document.documentElement).appendChild(style);

			//#region store: host settings namespace, browser-local fallback
			let scope;
			let scopeUnbound = false;

			/** The bound settings scope, once the service can serve the namespace. */
			function resolveScope() {
				if (scope !== undefined) return scope;
				if (scopeUnbound) return undefined;
				let service;
				try {
					service = ctx && typeof ctx.get === 'function' ? ctx.get('settingsScope') : ctx ? ctx.settingsScope : undefined;
				} catch (error) {
					service = undefined;
				}
				if (!service || typeof service.bind !== 'function') return undefined;
				try {
					scope = service.bind({ namespace: NAMESPACE });
				} catch (error) {
					warn(ctx, 'settings scope bind failed: ' + String(error));
					scopeUnbound = true;
					return undefined;
				}
				return scope;
			}

			/** The browser-local fallback list. */
			function readLocal() {
				try {
					const raw = window.localStorage.getItem(STORAGE_KEY);
					const parsed = raw === null ? null : JSON.parse(raw);
					return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
				} catch (error) {
					return []; // absent, unparsable, or storage disabled: start empty
				}
			}

			function writeLocal(list) {
				try {
					window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
				} catch (error) {
					/* private mode / disabled storage: the order lives for this session only */
				}
			}

			/** Whether the one-line hint has been retired for this browser. */
			function readHintSeen() {
				try {
					return window.localStorage.getItem(HINT_KEY) === '1';
				} catch (error) {
					return false;
				}
			}

			function markHintSeen() {
				try {
					window.localStorage.setItem(HINT_KEY, '1');
				} catch (error) {
					/* storage disabled: the hint simply stays */
				}
				hintSeen = true;
			}

			let saved = [];
			let pendingLocal = false;
			let localMode = false;
			let hintSeen = readHintSeen();
			/** Footer diagnosis: a failed write or unresolvable rows. */
			let diagnosis = null;
			let echo = null;
			let echoAt = 0;

			/** Adopt the authoritative order for this browser; keep a pending write's value until it echoes. */
			function refresh() {
				const bound = resolveScope();
				let snapshot;
				try {
					snapshot = bound ? bound.getSnapshot() : undefined;
				} catch (error) {
					snapshot = undefined;
				}
				if (snapshot && snapshot.status === 'loading') return; // keep the last good list
				const hostReady = Boolean(bound && snapshot && snapshot.mode === 'host' && snapshot.status === 'ready' && snapshot.value);
				localMode = !hostReady;
				let incoming;
				if (hostReady) {
					const value = snapshot.value;
					incoming = Array.isArray(value.order) ? value.order.filter((id) => typeof id === 'string') : [];
				} else {
					incoming = readLocal();
				}
				if (pendingLocal) {
					if (sameOrder(incoming, saved)) {
						pendingLocal = false;
						echo = null;
						saved = incoming;
					}
					return; // a rejected write stays pending until the host echoes it back
				}
				if (echo !== null && Date.now() - echoAt < 5000) {
					if (sameOrder(incoming, echo)) {
						saved = incoming;
						echo = null;
					}
					return; // a superseded read: keep the order the user just made
				}
				echo = null;
				saved = incoming;
			}

			/** Persist one ordered id list; a rejected host write keeps the browser-local copy. */
			function commit(next) {
				if (next.some((id) => typeof id === 'string' && id.slice(0, 6) === 'label:')) {
					// fiber-unreadable rows: the label fallback identifies rows for
					// display only, never as something to persist
					return Promise.resolve();
				}
				saved = next.slice();
				echo = saved.slice();
				echoAt = Date.now();
				diagnosis = null;
				markHintSeen();
				const bound = resolveScope();
				if (localMode || !bound) {
					writeLocal(saved);
					scheduleSync();
					return Promise.resolve();
				}
				let written;
				try {
					written = bound.set('order', saved);
				} catch (error) {
					written = Promise.reject(error);
				}
				return Promise.resolve(written)
					.catch((error) => {
						warn(ctx, 'persist failed: ' + String(error));
						diagnosis = T.writeFailed;
						pendingLocal = true;
						writeLocal(saved); // keep the gesture effective for this browser
					})
					.then(() => {
						if (diagnosis === null) pendingLocal = false;
						scheduleSync();
					});
			}
			//#endregion

			//#region navigation model
			/**
			 * The rows of the open Settings navigation, or null while it is closed.
			 * `ids[i]` belongs to `cells[i]`; a null entry marks a row this build
			 * cannot identify.
			 */
			function readNav() {
				const navList = document.querySelector(NAV_LIST_SELECTOR);
				if (!navList) return null;
				const cells = Array.prototype.filter.call(navList.children, (el) => el.matches && el.matches(NAV_CELL_SELECTOR));
				if (cells.length === 0) return null;
				const ids = [];
				for (const cell of cells) ids.push(cellId(cell));
				return { navList, cells, ids };
			}

			/** Whether every rendered row carries a usable identity. */
			function identified(nav) {
				for (const id of nav.ids) if (id === null) return false;
				return true;
			}

			/** The row the shell is currently showing, by id. */
			function activeId(nav) {
				for (let index = 0; index < nav.cells.length; index++) {
					if (nav.cells[index].getAttribute(ACTIVE_ATTRIBUTE) === 'true') return nav.ids[index];
				}
				return null;
			}

			/** Move the rows into the given order; the parent never changes. */
			function applyOrder(nav, order) {
				const byId = new Map();
				nav.cells.forEach((cell, index) => byId.set(nav.ids[index], cell));
				for (const id of order) {
					const cell = byId.get(id);
					if (cell) nav.navList.appendChild(cell);
				}
			}

			/**
			 * The shell's own row order, read from the live `settings.section` list
			 * slot (SlotCore keeps list entries sorted by priority then `order`), or
			 * null when the slot service is not reachable.
			 */
			function shellOrder() {
				try {
					const slots = ctx && typeof ctx.get === 'function' ? ctx.get('slots') : ctx ? ctx.slots : undefined;
					if (!slots || typeof slots.entries !== 'function') return null;
					const rows = slots.entries('settings.section');
					if (!Array.isArray(rows)) return null;
					const ids = [];
					for (const row of rows) {
						const id = row && row.options ? row.options.id : undefined;
						if (typeof id === 'string' && id !== '' && ids.indexOf(id) === -1) ids.push(id);
					}
					return ids.length > 0 ? ids : null;
				} catch (error) {
					return null;
				}
			}

			/** The shell's order restricted to the rows on screen; null when unknown. */
			let natural = null;
			let naturalKnown = false;

			function rememberNatural(ids) {
				const fromSlots = shellOrder();
				if (fromSlots) {
					const filtered = fromSlots.filter((id) => ids.indexOf(id) !== -1);
					natural = filtered.length === ids.length ? filtered : null;
					naturalKnown = natural !== null;
					return;
				}
				if (natural === null || natural.length !== ids.length || ids.some((id) => natural.indexOf(id) === -1)) {
					natural = ids.slice();
					naturalKnown = false; // best effort: no trustworthy reset target
				}
			}

			/** The order the rows should show right now. */
			function desiredOrder(nav) {
				if (saved.length > 0) return mergeOrder(saved, nav.ids);
				if (naturalKnown && natural !== null && natural.length === nav.ids.length) return natural.slice();
				return nav.ids.slice();
			}

			/** Move `id` by `delta` positions; null when that changes nothing. */
			function shiftId(ids, id, delta) {
				const from = ids.indexOf(id);
				const to = from + delta;
				if (from === -1 || to < 0 || to >= ids.length) return null;
				const next = ids.slice();
				next[from] = next[to];
				next[to] = id;
				return next;
			}

			/** Move `id` next to `targetId`; null when that changes nothing. */
			function moveId(ids, id, targetId, before) {
				const rest = ids.filter((value) => value !== id);
				const index = rest.indexOf(targetId);
				if (index === -1) return null;
				rest.splice(before ? index : index + 1, 0, id);
				return sameOrder(rest, ids) ? null : rest;
			}
			//#endregion

			//#region footer: ↑ ↓ reset, hint, diagnosis
			let foot = null;

			function makeButton(marker, label, title) {
				const button = document.createElement('button');
				button.type = 'button';
				button.dataset.dshso = marker;
				button.className = 'dshso-btn';
				button.textContent = label;
				button.title = title;
				button.setAttribute('aria-label', title);
				return button;
			}

			/** Build the footer once, then only ever update its state. */
			function ensureFoot(nav) {
				const host = nav.navList.parentElement;
				if (!host) return null;
				if (foot && foot.isConnected && foot.parentElement === host) return foot;
				foot = host.querySelector('[data-dshso="foot"]');
				if (foot) return foot;
				foot = document.createElement('div');
				foot.dataset.dshso = 'foot';
				foot.className = 'dshso-foot';
				const controls = document.createElement('div');
				controls.className = 'dshso-controls';
				const up = makeButton('up', '↑', T.up);
				const down = makeButton('down', '↓', T.down);
				const reset = makeButton('reset', T.reset, T.resetTitle);
				reset.classList.add('dshso-reset');
				reset.hidden = true;
				up.addEventListener('click', () => onShift(-1));
				down.addEventListener('click', () => onShift(1));
				reset.addEventListener('click', () => {
					void commit([]);
				});
				controls.append(up, down, reset);
				const hint = document.createElement('div');
				hint.className = 'dshso-hint';
				hint.dataset.dshso = 'hint';
				hint.textContent = T.hint;
				const note = document.createElement('div');
				note.className = 'dshso-note';
				note.dataset.dshso = 'note';
				note.hidden = true;
				foot.append(controls, hint, note);
				host.appendChild(foot);
				return foot;
			}

			/** Move the selected page one place, driven by the footer's ↑ / ↓. */
			function onShift(delta) {
				const nav = readNav();
				if (!nav || !identified(nav)) return;
				const id = activeId(nav);
				if (id === null) return;
				const current = desiredOrder(nav);
				const next = shiftId(current, id, delta);
				if (next) void commit(next);
			}

			/** Draw the footer's current state (never the cause of an order change). */
			function renderFoot(nav, order) {
				const element = ensureFoot(nav);
				if (!element) return;
				const active = identified(nav) ? activeId(nav) : null;
				const index = active === null || order === null ? -1 : order.indexOf(active);
				const up = element.querySelector('[data-dshso="up"]');
				const down = element.querySelector('[data-dshso="down"]');
				const reset = element.querySelector('[data-dshso="reset"]');
				up.disabled = index <= 0;
				down.disabled = index === -1 || order === null || index >= order.length - 1;
				const customized = naturalKnown && natural !== null && order !== null && !sameOrder(order, natural);
				reset.hidden = !customized;
				const hint = element.querySelector('[data-dshso="hint"]');
				hint.hidden = hintSeen;
				const note = element.querySelector('[data-dshso="note"]');
				const labelIds = order !== null && order.some((id) => typeof id === 'string' && id.slice(0, 6) === 'label:');
				const text = diagnosis !== null ? diagnosis : labelIds ? T.unreadable : localMode ? T.local : '';
				note.hidden = text === '';
				if (text !== '') note.textContent = text;
				note.dataset.tone = diagnosis === T.writeFailed ? 'error' : 'info';
			}

			/** Remove the footer (dialog closed, or the plugin is disposing). */
			function dropFoot() {
				if (foot && foot.isConnected) foot.remove();
				foot = null;
			}
			//#endregion

			//#region row decoration and drag
			function decorate(nav) {
				if (nav.navList.dataset.dshsoBound !== '1') {
					nav.navList.dataset.dshsoBound = '1';
					nav.navList.addEventListener('dragstart', onDragStart);
					nav.navList.addEventListener('dragover', onDragOver);
					nav.navList.addEventListener('dragleave', onDragLeave);
					nav.navList.addEventListener('drop', onDrop);
					nav.navList.addEventListener('dragend', onDragEnd);
					nav.navList.addEventListener('keydown', onKeyDown);
					boundList = nav.navList;
				}
				for (const cell of nav.cells) {
					if (cell.dataset.dshsoCell === '1') continue;
					cell.dataset.dshsoCell = '1';
					cell.draggable = true;
					if (!cell.title) cell.title = T.hint;
				}
			}

			let dragCell = null;
			let boundList = null;
			let dragId = null;
			let dropAt = null;

			function cellFrom(target) {
				if (!target || typeof target.closest !== 'function') return null;
				return target.closest(NAV_CELL_SELECTOR);
			}

			function clearDropMarks() {
				for (const marked of document.querySelectorAll('[data-dshso-drop]')) delete marked.dataset.dshsoDrop;
			}

			function clearDragState() {
				clearDropMarks();
				if (dragCell) delete dragCell.dataset.dshsoDragging;
				dragCell = null;
				dragId = null;
				dropAt = null;
			}

			function onDragStart(event) {
				const cell = cellFrom(event.target);
				if (!cell) return;
				const id = cellId(cell);
				if (id === null) return;
				dragCell = cell;
				dragId = id;
				cell.dataset.dshsoDragging = '1';
				if (event.dataTransfer) {
					event.dataTransfer.effectAllowed = 'move';
					try {
						event.dataTransfer.setData('text/plain', id);
					} catch (error) {
						/* some engines restrict payload writes: the internal state is enough */
					}
				}
			}

			function onDragOver(event) {
				if (dragId === null) return;
				const cell = cellFrom(event.target);
				if (!cell) return;
				event.preventDefault(); // a valid drop target
				if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
				const id = cellId(cell);
				if (id === null || id === dragId) {
					clearDropMarks();
					dropAt = null;
					return;
				}
				const box = cell.getBoundingClientRect();
				const before = event.clientY < box.top + box.height / 2;
				clearDropMarks();
				cell.dataset.dshsoDrop = before ? 'before' : 'after';
				dropAt = { id, before };
			}

			function onDragLeave(event) {
				if (dragId === null) return;
				const related = event.relatedTarget;
				if (related && typeof related.closest === 'function' && related.closest(NAV_LIST_SELECTOR)) return;
				clearDropMarks();
				dropAt = null;
			}

			function onDrop(event) {
				if (dragId === null) return;
				event.preventDefault();
				const cell = cellFrom(event.target);
				let at = dropAt;
				if (!cell) {
					at = null;
				} else if (at === null || at.id !== cellId(cell)) {
					const id = cellId(cell);
					const box = cell.getBoundingClientRect();
					at = id === null ? null : { id, before: event.clientY < box.top + box.height / 2 };
				}
				const id = dragId;
				clearDragState();
				if (id === null || at === null || at.id === id) return;
				const nav = readNav();
				if (!nav || !identified(nav)) return;
				const next = moveId(nav.ids, id, at.id, at.before);
				if (next) void commit(next);
			}

			function onDragEnd() {
				clearDragState();
			}

			function onKeyDown(event) {
				if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
				const cell = cellFrom(event.target);
				if (!cell) return;
				const nav = readNav();
				if (!nav || !identified(nav)) return;
				const id = cellId(cell);
				if (id === null) return;
				const current = desiredOrder(nav);
				const next = shiftId(current, id, event.key === 'ArrowUp' ? -1 : 1);
				if (next === null) return;
				event.preventDefault();
				event.stopPropagation(); // the dialog's own key handling stays out of this
				void commit(next);
			}
			//#endregion

			//#region sync driver
			let timer = null;

			function scheduleSync() {
				if (timer !== null) return;
				timer = setTimeout(() => {
					timer = null;
					try {
						sync();
					} catch (error) {
						warn(ctx, 'sync failed: ' + String(error));
					}
				}, 50);
			}

			function sync() {
				if (!document.body) return;
				const nav = readNav();
				if (!nav) {
					clearDragState(); // the dialog is closed: nothing to draw
					return;
				}
				refresh();
				decorate(nav);
				if (!identified(nav)) {
					// The shell's markup changed under us: diagnose instead of guessing.
					diagnosis = T.unreadable;
					clearDragState();
					renderFoot(nav, null);
					return;
				}
				if (diagnosis === T.unreadable) diagnosis = null;
				rememberNatural(nav.ids);
				if (dragId !== null) return; // never move rows under an active drag
				const desired = desiredOrder(nav);
				if (!sameOrder(nav.ids, desired)) applyOrder(nav, desired);
				renderFoot(nav, desired);
			}
			//#endregion

			//#region lifecycle
			const subscriptions = [];
			const boundAtStart = resolveScope();
			if (boundAtStart && typeof boundAtStart.subscribe === 'function') {
				try {
					subscriptions.push(boundAtStart.subscribe(scheduleSync));
				} catch (error) {
					/* settings feed unavailable */
				}
			}

			const observer = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					const target = mutation.target;
					if (!target || target.nodeType !== 1) continue;
					if (typeof target.closest === 'function' && target.closest('[role="dialog"]') !== null) {
						scheduleSync();
						return;
					}
					if (typeof target.querySelector === 'function' && target.querySelector(NAV_LIST_SELECTOR) !== null) {
						scheduleSync();
						return;
					}
					if (typeof target.matches === 'function' && target.matches(NAV_LIST_SELECTOR)) {
						scheduleSync();
						return;
					}
				}
			});
			observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

			const interval = setInterval(scheduleSync, 2000);
			const onStorage = () => {
				scheduleSync();
			};
			window.addEventListener('storage', onStorage);

			if (ctx && typeof ctx.effect === 'function') {
				ctx.effect(() => () => {
					style.remove();
					observer.disconnect();
					clearInterval(interval);
					window.removeEventListener('storage', onStorage);
					if (timer !== null) clearTimeout(timer);
					clearDragState();
					dropFoot();
					for (const dispose of subscriptions) {
						try {
							dispose();
						} catch (error) {
							/* already disposed */
						}
					}
					if (boundList) {
						boundList.removeEventListener('dragstart', onDragStart);
						boundList.removeEventListener('dragover', onDragOver);
						boundList.removeEventListener('dragleave', onDragLeave);
						boundList.removeEventListener('drop', onDrop);
						boundList.removeEventListener('dragend', onDragEnd);
						boundList.removeEventListener('keydown', onKeyDown);
						delete boundList.dataset.dshsoBound;
						boundList = null;
					}
					for (const cell of document.querySelectorAll('[data-dshso-cell]')) {
						delete cell.dataset.dshsoCell;
						cell.removeAttribute('draggable');
						if (cell.title === T.hint) cell.removeAttribute('title');
					}
				}, 'dsh-settings-order: cleanup');
			}

			scheduleSync();
			//#endregion
		}

		exports.apply = apply;
		return module.exports;
	},
});
