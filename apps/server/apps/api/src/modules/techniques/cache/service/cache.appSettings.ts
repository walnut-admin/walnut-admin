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

  // ── L3 进程内 memo ────────────────────────────────────────────────────────
  // APP:SETTING 是「写极稀疏、读极高频」的配置小表缓存：functional.guard 每请求
  // getAppSettings、各 get*Config 每次调用都走 Redis GET + JSON.parse。这里加两层
  // 进程内 memo：
  // - appSettingsMemo：整表 { settingKey → settingValue } 原始映射（getAppSettings 出参），
  //   省掉每请求的 Redis GET；
  // - settingMemo：getSetting 解析后的每 key 值，省掉重复 JSON.parse。
  //
  // 一致性边界（重要）：
  // 1. 失效点是 setAppSettings —— 全部写路径（setting create/update →
  //    extractAppSettingIntoCache、cache/refresh 端点、updateAppSettingByKey 的
  //    runAfterCommit 刷新、启动期 task.service 预热）都收口到它，写后即清 memo，
  //    同进程后续读立即见新值；monitor 端点的按 key 删除亦接了失效（见
  //    AppMonitorCacheController.deleteCache）。
  // 2. 单实例部署下语义安全；**多实例下其他实例的写不会失效本进程 memo**（无
  //    Redis keyspace 通知，LISTEN/NOTIFY 为 roadmap 记录的可选后续），其他实例
  //    写完 setting 后本进程最长要等到本进程下一次 setAppSettings 才回正。当前
  //    部署形态是单实例，此边界可接受，扩多实例前必须先补跨实例失效。
  // 3. Redis 侧被外部直接删 key（监控台手工删 APP:SETTING 等）同样进不了失效 ——
  //    memo 只信自己的写通道。null 结果不入 memo（Redis 清空/未预热可自愈）。
  private appSettingsMemo: typeof WalnutAdminConstAppSettingKeys | null = null
  private readonly settingMemo = new Map<IWalnutAdminConstAppSettingKeys, unknown>()

  private invalidateAppSettingsMemo() {
    this.appSettingsMemo = null
    this.settingMemo.clear()
  }

  /**
   * 供「绕过 setAppSettings 直删 Redis」的外部通道做防御性失效（当前消费方：
   * 监控台按 key 删缓存）。无条件清 memo，重建成本只是一次 Redis GET。
   */
  public invalidateMemoForExternalCacheRemoval() {
    this.invalidateAppSettingsMemo()
  }

  async setAppSettings(value: any, opt: IWalnutAdminCacheOptions) {
    await this.cacheService.set(
      WalnutAdminConstAppCacheKeys.APP_SETTING,
      value,
      opt,
    )
    // 写路径统一收口在这里 → 写后失效进程内 memo（同进程读立即见新值）
    this.invalidateAppSettingsMemo()
  }

  async getAppSettings() {
    // memo 命中：纯内存返回（引用共享 —— 消费方均为只读取值，无写回方）
    if (this.appSettingsMemo !== null) {
      return this.appSettingsMemo
    }

    const cached = await this.cacheService.get<typeof WalnutAdminConstAppSettingKeys>(
      WalnutAdminConstAppCacheKeys.APP_SETTING,
    )

    // null 不入 memo：Redis 未预热/被清空时保持「回源自愈」的既有行为
    if (cached !== null && cached !== undefined) {
      this.appSettingsMemo = cached
    }

    return cached!
  }

  private async getSetting<T>(
    key: IWalnutAdminConstAppSettingKeys,
    defaultValue: T,
  ): Promise<T> {
    // 解析结果 memo 命中（成功解析过的 key 才会进 Map，用 has 而非 undefined 哨兵 ——
    // 值本身合法地可能是 null）
    if (this.settingMemo.has(key)) {
      return this.settingMemo.get(key) as T
    }

    try {
      const appSetting = await this.getAppSettings()
      const parsed = JSON.parse(appSetting[key as keyof typeof appSetting]) as T
      this.settingMemo.set(key, parsed)
      return parsed
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
    // B7a：visitor role 的 v5 uuid（ETL namespace 派生自原 hex 5fb27aee3a30b717d8078eb5，
    // 派生规则见 packages/tooling/scripts/src/db/uuid5.ts；B5 订正脚本把 setting 值统一成
    // uuid 后，缺省兜底也必须是 uuid —— PG 侧 current_role_id / sys_user_role.role_id
    // 是 uuid 列，hex 兜底会让默认链路插入直接炸）
    defaultRole: 'd6e8ca57-1faf-56d7-b090-9ff0c0b78ce6',
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
