/**
 * Locale / i18n language constants — shared between frontend and backend.
 */

import type { ValueOf } from 'easy-fns-ts'

export const Locale = {
  zh_CN: 'zh_CN',
  en_US: 'en_US',
} as const

/** Type for locale values: 'zh_CN' | 'en_US' */
export type LocaleType = ValueOf<typeof Locale>
