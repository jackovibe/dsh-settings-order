// SPDX-License-Identifier: MIT
/**
 * Host half of dsh-settings-order. The active order is a volatile Config field,
 * so DSH 0.1.7+'s schema-derived SettingsForms can persist it under the loader
 * entry id (`settings-order`). Older hosts still receive the legacy namespace
 * registration when their settings service provides that API.
 *
 * @module dsh-settings-order
 */
import z from '@deepseek-ai/schemastery'

export const name = 'settings-order'
export const inject = ['settings']

/** User-layer configuration mirrored by the browser half. */
export const Config = z.object({
  /** Settings-navigation entry ids, first row first. */
  order: z.array(z.string()).default([]).volatile(),
})

/** Preserve compatibility with hosts that still expose the legacy API. */
export function apply(ctx) {
  const settings = ctx.settings
  if (settings && typeof settings.register === 'function') {
    settings.register(name, Config, {
      base: { order: [] },
      applies: 'live',
    })
  }
}
