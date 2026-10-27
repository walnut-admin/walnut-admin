/**
 * User Preference Module Constants
 * （自 schema/user_preference.schema.ts 搬出：schema 只留 DTO 元数据类，业务常量归 const 文件）
 */

import type { ValueOf } from 'easy-fns-ts'

export const fontSizeConst = {
  10: 10,
  12: 12,
  14: 14,
  16: 16,
  20: 20,
} as const

export type IFontSizeConst = ValueOf<typeof fontSizeConst>

export const colorModeConst = {
  DEFAULT: 'default',
  CAFE: 'cafe',
  CONTRAST: 'contrast',
  GRAYSCALE: 'grayscale',
  GRAYSCALE_INVERTED: 'grayscale-inverted',
  INVERTED: 'inverted',
} as const

export type IColorModeConst
  = ValueOf<typeof colorModeConst>

export const CVDConst = {
  DEFAULT: 'default',
  PROTANOPIA: 'protanopia', // no red
  DEUTERANOPIA: 'deuteranopia', // no green
  TRITANOPIA: 'tritanopia', // no blue
  ACHROMATOPIA: 'achromatopsia', // no color
} as const

export type ICVDConst
  = ValueOf<typeof CVDConst>

export const layoutModeConst = {
  LEFT_MENU: 'left-menu',
  TOP_MENU: 'top-menu',
} as const

export type ILayoutModeConst
  = ValueOf<typeof layoutModeConst>
