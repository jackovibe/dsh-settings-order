// SPDX-License-Identifier: MIT
/**
 * Host half of dsh-settings-order: registers the durable `settings-order`
 * settings namespace holding one ordered list of Settings-navigation entry
 * ids (the ids the Settings shell registers into its `settings.section` list
 * slot — "general", "plugins", "archived-sessions", …).
 *
 * The namespace is presentation data only: it never touches sessions,
 * workspaces, plugin loading, or any slot registration. The browser half reads
 * it through its settings scope and reorders the already-rendered navigation
 * rows; on builds or browsers whose transport cannot carry the namespace it
 * degrades to browser-local storage and says so in the navigation footer.
 *
 * @module dsh-settings-order
 */
import z from '@deepseek-ai/schemastery'

export const name = 'settings-order'

export const inject = ['settings']

/** User-layer document mirrored by the browser half. */
const OrderSchema = z.object({
  /** Settings-navigation entry ids, first row first. */
  order: z.array(z.string()).default([]),
})

/**
 * Register the `settings-order` settings namespace.
 * @param ctx - harness context exposing the settings service.
 */
export function apply(ctx) {
  ctx.settings.register('settings-order', OrderSchema, {
    base: { order: [] },
    applies: 'live',
  })
}
