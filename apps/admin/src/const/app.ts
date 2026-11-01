import type { ValueOf } from 'easy-fns-ts'
import { RequestHeaders as RequestHeadersContract } from '@walnut/contract/http'
import { Locale as LocaleContract } from '@walnut/contract/i18n'
import { colorModeConst, CVDConst, layoutModeConst } from '@walnut/contract/preference'
import { Role } from '@walnut/contract/role'
import { LockModeConst } from '@walnut/contract/user-lock'

export const AppConstDevice = {
  MOBILE: 'mobile',
  TABLET: 'tablet',
  LAPTOP: 'laptop',
  DESKTOP: 'desktop',
} as const

export type ValueOfAppConstDevice = ValueOf<typeof AppConstDevice>

export const AppConstFontSize = {
  EN_US: 'en_US',
  ZH_CN: 'zh_CN',
} as const

export type ValueOfAppConstFontSize = ValueOf<typeof AppConstFontSize>

export const AppConstLocale = {
  EN_US: LocaleContract.en_US,
  ZH_CN: LocaleContract.zh_CN,
} as const

export type ValueOfAppConstLocale = ValueOf<typeof AppConstLocale>

export const AppConstCollapseMode = {
  ICON: 'icon',
  BAR: 'bar',
  ARROW_CIRCLE: 'arrow-circle',
  BUTTON: 'button',
} as const

export type ValueOfAppConstCollapseMode = ValueOf<typeof AppConstCollapseMode>

// 偏好 / 锁模式的 wire 值集已上收 @walnut/contract；同名 re-export 保住既有视图 import
export const AppConstLayoutMode = layoutModeConst

export type ValueOfAppConstLayoutMode = ValueOf<typeof AppConstLayoutMode>

export const AppConstLockMode = LockModeConst

export type ValueOfAppConstLockMode = ValueOf<typeof AppConstLockMode>

export const AppConstBasicMode = {
  GLOBAL: 'global',
  SCOPE: 'scope',
} as const

export type ValueOfAppConstBasicMode = ValueOf<typeof AppConstBasicMode>

export const AppConstColorMode = colorModeConst

export type ValueOfAppConstColorMode = ValueOf<typeof AppConstColorMode>

export const AppConstCVD = CVDConst

export type ValueOfAppCVD = ValueOf<typeof AppConstCVD>

export const AppConstRoles = Role

export type ValueOfAppConstRoles = ValueOf<typeof AppConstRoles>

export const AppConstRequestHeaders = {
  AUTHORIZATION: RequestHeadersContract.AUTHORIZATION,
  LANGUAGE: RequestHeadersContract.LANGUAGE,
  FINGERPRINT: RequestHeadersContract.FINGERPRINT,
  SIGN: RequestHeadersContract.SIGN,
  TIMESTAMP: RequestHeadersContract.TIMESTAMP,
  NONCE: RequestHeadersContract.NONCE,
} as const

export type ValueOfAppConstRequestHeaders = ValueOf<typeof AppConstRequestHeaders>
