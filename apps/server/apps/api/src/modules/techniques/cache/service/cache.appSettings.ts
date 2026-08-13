import { Injectable, Logger } from '@nestjs/common'
import { IWalnutAdminConstAppSettingKeys, WalnutAdminConstAppCacheKeys, WalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'
import { IWalnutAdminConstAppSettingAuthEmailKeys, IWalnutAdminConstAppSettingAuthOAuthGiteeKeys, IWalnutAdminConstAppSettingAuthOAuthGitHubKeys, IWalnutAdminConstAppSettingAuthOAuthGoogleKeys, IWalnutAdminConstAppSettingAuthOpaqueKeys, IWalnutAdminConstAppSettingAuthSmsKeys, IWalnutAdminConstAppSettingCapJSKeys, IWalnutAdminConstAppSettingCryptoHKDFKeys, IWalnutAdminConstAppSettingForceQuit, IWalnutAdminConstAppSettingFunctionalFrontendKeys, IWalnutAdminConstAppSettingFunctionalFrontendScopeKeys, IWalnutAdminConstAppSettingFunctionalRoleKeys, IWalnutAdminConstAppSettingMfaKeys, WalnutAdminConstAppSettingScopeType } from '@walnut-server/const/app/setting'

import { IWalnutAdminConstRoleMode, WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { Recordable } from 'easy-fns-ts'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'

@Injectable()
export class AppTechCacheAppSettingsService {
  private readonly logger = new Logger(AppTechCacheAppSettingsService.name)

  constructor(private readonly cacheService: AppTechCacheService) { }

  async setAppSettings(value: any, opt: IWalnutAdminCacheOptions) {
    await this.cacheService.set(
      WalnutAdminConstAppCacheKeys.APP_SETTING,
      value,
      opt,
    )
  }

  async getAppSettings() {
    const cached = await this.cacheService.get<typeof WalnutAdminConstAppSettingKeys>(
      WalnutAdminConstAppCacheKeys.APP_SETTING,
    )
    return cached!
  }

  private async getSetting<T>(
    key: IWalnutAdminConstAppSettingKeys,
    defaultValue: T,
  ): Promise<T> {
    try {
      const appSetting = await this.getAppSettings()
      return JSON.parse(appSetting[key as keyof typeof appSetting]) as T
    }
    catch (error) {
      this.logger.error(error)
      return defaultValue
    }
  }

  private readonly defaultCryptoHKDFConfig: IWalnutAdminConstAppSettingCryptoHKDFKeys = {
    API_SIGN: 'walnut-admin-api-sign-v1',
  }

  async getCryptoHKDFInfo(): Promise<IWalnutAdminConstAppSettingCryptoHKDFKeys> {
    return this.getSetting(
      WalnutAdminConstAppSettingKeys.APP_GLOBAL_CRYPTO_HKDF,
      this.defaultCryptoHKDFConfig,
    )
  }

  private readonly defaultOSWhiteList: string[] = ['Mobile', 'Mac OS', 'Windows', 'UNIX', 'Linux', 'iOS', 'Android']
  async getOSWhiteList(): Promise<string[]> {
    return this.getSetting(
      WalnutAdminConstAppSettingKeys.APP_GLOBAL_OS_WHITELIST,
      this.defaultOSWhiteList,
    )
  }

  private readonly defaultBrowserWhiteList: string[] = ['IE', 'Safari', 'Mobile Safari', 'Edge', 'Opera', 'Chrome', 'Mobile Chrome', 'Firefox', 'Samsung Browser', 'UCBrowser']
  async getBrowserWhiteList(): Promise<string[]> {
    return this.getSetting(
      WalnutAdminConstAppSettingKeys.APP_GLOBAL_BROWSER_WHITELIST,
      this.defaultBrowserWhiteList,
    )
  }

  private readonly defaultCapJSConfig: IWalnutAdminConstAppSettingCapJSKeys = {
    count: 10,
    size: 16,
    difficulty: 4,
    ttl: 60 * 60 * 1000, // 1 hour
    throttleLimit: 4,
    throttleTtl: 60, // 1 minute
  }

  async getCapJSConfig(): Promise<IWalnutAdminConstAppSettingCapJSKeys> {
    return this.getSetting(
      WalnutAdminConstAppSettingKeys.APP_GLOBAL_CAPJS_CONFIG,
      this.defaultCapJSConfig,
    )
  }

  private readonly defaultMfaConfig: IWalnutAdminConstAppSettingMfaKeys = {
    methodsRequiredCount: 1,
  }

  async getAuthMfaConfig(): Promise<IWalnutAdminConstAppSettingMfaKeys> {
    return this.getSetting(
      WalnutAdminConstAppSettingKeys.APP_AUTH_MFA,
      this.defaultMfaConfig,
    )
  }

  private readonly defaultForceQuitConfig: IWalnutAdminConstAppSettingForceQuit = {
    updatePass: 'FORCE_COUNTDOWN_MODAL',
    resetPass: 'FORCE_COUNTDOWN_MODAL',
    updateEmail: 'FORCE_COUNTDOWN_MODAL',
    updatePhoneNumber: 'FORCE_COUNTDOWN_MODAL',
    forceQuitOnline: 'FORCE_IMMEDIATE_SIGNOUT',
    forceQuitOffline: 'FORCE_COUNTDOWN_MODAL',
    currentRoleBanned: 'FORCE_IMMEDIATE_SIGNOUT',
    currentUserBanned: 'FORCE_IMMEDIATE_SIGNOUT',
    deviceBanned: 'FORCE_IMMEDIATE_SIGNOUT',
    deviceHighRisk: 'FORCE_COUNTDOWN_MODAL',
    versionUpgrade: 'MANUAL_COUNTDOWN_MODAL',
    userKickOther: 'MANUAL_COUNTDOWN_MODAL',
  }

  async getForceQuitConfig(): Promise<IWalnutAdminConstAppSettingForceQuit> {
    return this.getSetting(
      WalnutAdminConstAppSettingKeys.APP_GLOBAL_FORCE_QUIT_CONFIG,
      this.defaultForceQuitConfig,
    )
  }

  private readonly defaultEmailConfig: IWalnutAdminConstAppSettingAuthEmailKeys = {
    authEnable: 0,
    sendEnable: 0,
    verifyFigure: 6,
    verifyTtl: 300,
    sendLimit: 5,
    sendTtl: 600,
    newUserSignup: 0,
  }

  async getAuthEmailConfig(): Promise<IWalnutAdminConstAppSettingAuthEmailKeys> {
    return this.getSetting(
      WalnutAdminConstAppSettingKeys.APP_AUTH_EMAIL,
      this.defaultEmailConfig,
    )
  }

  private readonly defaultSmsConfig: IWalnutAdminConstAppSettingAuthSmsKeys = {
    authEnable: 0,
    sendEnable: 0,
    verifyFigure: 6,
    verifyTtl: 300,
    sendLimit: 5,
    sendTtl: 600,
    newUserSignup: 0,
  }

  async getAuthSmsConfig(): Promise<IWalnutAdminConstAppSettingAuthSmsKeys> {
    return this.getSetting(
      WalnutAdminConstAppSettingKeys.APP_AUTH_PHONE,
      this.defaultSmsConfig,
    )
  }

  private readonly defaultGoogleConfig: IWalnutAdminConstAppSettingAuthOAuthGoogleKeys = {
    authEnable: 0,
    newUserSignup: 0,
  }

  async getAuthOAuthGoogleConfig(): Promise<IWalnutAdminConstAppSettingAuthOAuthGoogleKeys> {
    return this.getSetting(
      WalnutAdminConstAppSettingKeys.APP_AUTH_GOOGLE,
      this.defaultGoogleConfig,
    )
  }

  private readonly defaultOpaqueConfig: IWalnutAdminConstAppSettingAuthOpaqueKeys = {
    authEnable: 0,
    register: 0,
    forget: 0,
    change: 0,
  }

  async getAuthOpaqueConfig(): Promise<IWalnutAdminConstAppSettingAuthOpaqueKeys> {
    return this.getSetting(
      WalnutAdminConstAppSettingKeys.APP_AUTH_OPAQUE,
      this.defaultOpaqueConfig,
    )
  }

  private readonly defaultOAuthGitHubConfig: IWalnutAdminConstAppSettingAuthOAuthGitHubKeys = {
    authEnable: 0,
    newUserSignup: 0,
  }

  async getAuthOAuthGitHubConfig(): Promise<IWalnutAdminConstAppSettingAuthOAuthGitHubKeys> {
    return this.getSetting(
      WalnutAdminConstAppSettingKeys.APP_AUTH_GITHUB,
      this.defaultOAuthGitHubConfig,
    )
  }

  private readonly defaultOAuthGiteeConfig: IWalnutAdminConstAppSettingAuthOAuthGiteeKeys = {
    authEnable: 0,
    newUserSignup: 0,
  }

  async getAuthOAuthGiteeConfig(): Promise<IWalnutAdminConstAppSettingAuthOAuthGiteeKeys> {
    return this.getSetting(
      WalnutAdminConstAppSettingKeys.APP_AUTH_GITEE,
      this.defaultOAuthGiteeConfig,
    )
  }

  private readonly defaultFunctionalRole: IWalnutAdminConstAppSettingFunctionalRoleKeys<IWalnutAdminConstRoleMode> = {
    scope: WalnutAdminConstAppSettingScopeType.GLOBAL,
    globalValue: WalnutAdminConstRoleMode.SWITCH,
    localKey: 'roleMode',
    defaultRole: '5fb27aee3a30b717d8078eb5', // visitor id
  }

  async getFunctionalRole(): Promise<IWalnutAdminConstAppSettingFunctionalRoleKeys<IWalnutAdminConstRoleMode>> {
    return this.getSetting(
      WalnutAdminConstAppSettingKeys.APP_FUNCTIONAL_ROLE,
      this.defaultFunctionalRole,
    )
  }

  private readonly defaultFunctionalFrontMaskUrl: IWalnutAdminConstAppSettingFunctionalFrontendScopeKeys<boolean> = {
    status: true,
    scope: WalnutAdminConstAppSettingScopeType.GLOBAL,
    globalValue: true,
    localKey: 'maskUrl',
  }

  async getFunctionalFrontMaskUrl(): Promise<IWalnutAdminConstAppSettingFunctionalFrontendScopeKeys<boolean>> {
    return this.getSetting(
      WalnutAdminConstAppSettingKeys.APP_FUNCTIONAL_FRONT_MASK_URL,
      this.defaultFunctionalFrontMaskUrl,
    )
  }

  private readonly defaultFunctionalFrontHijackRefresh: IWalnutAdminConstAppSettingFunctionalFrontendScopeKeys<boolean> = {
    status: true,
    scope: WalnutAdminConstAppSettingScopeType.GLOBAL,
    globalValue: true,
    localKey: 'hijackRefresh',
  }

  async getFunctionalFrontHijackRefresh(): Promise<IWalnutAdminConstAppSettingFunctionalFrontendScopeKeys<boolean>> {
    return this.getSetting(
      WalnutAdminConstAppSettingKeys.APP_FUNCTIONAL_FRONT_HIJACK_REFRESH,
      this.defaultFunctionalFrontHijackRefresh,
    )
  }

  private readonly defaultFunctionalFrontWatermark: IWalnutAdminConstAppSettingFunctionalFrontendScopeKeys<Recordable> = {
    status: true,
    scope: WalnutAdminConstAppSettingScopeType.GLOBAL,
    globalValue: {},
    localKey: 'watermark',
  }

  async getFunctionalFrontWatermark(): Promise<IWalnutAdminConstAppSettingFunctionalFrontendScopeKeys<Recordable>> {
    return this.getSetting(
      WalnutAdminConstAppSettingKeys.APP_FUNCTIONAL_FRONT_WATERMARK,
      this.defaultFunctionalFrontWatermark,
    )
  }

  private readonly defaultFunctionalFrontTransition: IWalnutAdminConstAppSettingFunctionalFrontendScopeKeys<string> = {
    status: true,
    scope: WalnutAdminConstAppSettingScopeType.GLOBAL,
    globalValue: 'fade',
    localKey: 'transition',
  }

  async getFunctionalFrontTransition(): Promise<IWalnutAdminConstAppSettingFunctionalFrontendScopeKeys<string>> {
    return this.getSetting(
      WalnutAdminConstAppSettingKeys.APP_FUNCTIONAL_FRONT_TRANSITION,
      this.defaultFunctionalFrontTransition,
    )
  }

  private readonly defaultFunctionalPureFrontend: IWalnutAdminConstAppSettingFunctionalFrontendKeys = {
    fullScreen: 0,
    search: 0,
    dark: 0,
    locale: 0,
  }

  async getFunctionalFrontend(): Promise<IWalnutAdminConstAppSettingFunctionalFrontendKeys> {
    return this.getSetting(
      WalnutAdminConstAppSettingKeys.APP_FUNCTIONAL_FRONT,
      this.defaultFunctionalPureFrontend,
    )
  }
}
