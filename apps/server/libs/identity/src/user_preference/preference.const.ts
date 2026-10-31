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

/**
 * fontSizeConst 的值数组 —— swagger `enum` 的源（P3-13）。
 * 数字键对象直传 ApiProperty 时 @nestjs/swagger 解析不出值集（openapi enum: []，
 * openapi-typescript 生成 `never`）；数组形态才能产出 `enum: [10, 12, 14, 16, 20]`。
 * 校验侧（IsEnum）与 CHECK 漂移守卫仍以 fontSizeConst 对象为值集真源，两者同源。
 */
export const fontSizeValues: readonly IFontSizeConst[] = Object.values(fontSizeConst)

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
