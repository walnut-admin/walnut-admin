import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'
import { runAfterCommit } from '@walnut-server/db'

import { DataScopeService, isWalnutDataScopeSettingKey } from '@/modules/system/data-scope/data-scope.service'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'

import {
  AppSettingDTOCreateRequest,
  AppSettingDTOListRequest,
  AppSettingDTOUpdateRequest,
} from './dto/setting.dto'
import { AppSettingRepositoryService } from './repo/setting.repo.service'
import { AppSettingBasicRepository } from './setting.basic.repository'

/**
 * B4 迁移（service 层）：除 Mongo model 注入摘除（原本就未使用）外零逻辑改动；
 * 缓存刷新链路（create/update → extractAppSettingIntoCache）原样保留。
 */
@Injectable()
export class AppSettingService {
  private readonly logger = new Logger(AppSettingService.name)

  constructor(
    private readonly settingBasicRepo: AppSettingBasicRepository,
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
    private readonly settingRepoService: AppSettingRepositoryService,
    private readonly dataScopeService: DataScopeService,
  ) {}

  /**
   * 写通道收口（批 4 / L2，关闭 DESIGN-ISSUES P3-36）：重提取 APP:SETTING + 按需
   * bump 数据权限 epoch，两者同包在 `runAfterCommit` 里 —— 事务内推迟到提交后
   * （无事务时就地执行），且 bump 一定发生在新设置进缓存之后（新世代的首个描述符
   * 计算必须读到新设置；同进程 APP:SETTING memo 已在 setAppSettings 里清掉）。
   *
   * `app.functional.role` 判定吃 before/after 两个 key：改名**离开**该键同样要 bump
   * （effective roleMode 会回落到默认值）。方向只会失效，多 bump 无害。
   */
  private async refreshSettingsAndBumpEpochIfNeeded(
    ...settingKeys: Array<string | null | undefined>
  ): Promise<void> {
    await runAfterCommit(async () => {
      await this.settingRepoService.extractAppSettingIntoCache()

      if (settingKeys.some(isWalnutDataScopeSettingKey)) {
        await this.dataScopeService.bumpEpoch()
      }
    })
  }

  // base CRUD
  async create(dto: AppSettingDTOCreateRequest) {
    const created = await this.settingBasicRepo.create(dto)

    await this.refreshSettingsAndBumpEpochIfNeeded(dto.settingKey)

    return created
  }

  async read(id: string) {
    return this.settingBasicRepo.readById(id)
  }

  async update(id: string, dto: AppSettingDTOUpdateRequest) {
    // 改名离开 app.functional.role 也要 bump —— 更新前读旧 key（app_setting 是低写小表，
    // 多一次点查可接受；repo 的 update 内部读不回传 before）
    const before = await this.settingBasicRepo.readById(id)
    const updated = await this.settingBasicRepo.update(id, dto)

    await this.refreshSettingsAndBumpEpochIfNeeded(before.settingKey, dto.settingKey)

    return updated
  }

  async list(params: AppSettingDTOListRequest) {
    return this.settingBasicRepo.list(params)
  }

  // get auth form settings
  async getAuthSettings() {
    const res = await this.cacheAppSettingsService.getAppSettings()
    const emailConfig = await this.cacheAppSettingsService.getAuthEmailConfig()
    const smsConfig = await this.cacheAppSettingsService.getAuthSmsConfig()
    const githubConfig = await this.cacheAppSettingsService.getAuthOAuthGitHubConfig()
    const giteeConfig = await this.cacheAppSettingsService.getAuthOAuthGiteeConfig()
    const opaqueConfig = await this.cacheAppSettingsService.getAuthOpaqueConfig()
    const googleConfig = await this.cacheAppSettingsService.getAuthOAuthGoogleConfig()

    return {
      email: +emailConfig.authEnable === 1,
      phone: +smsConfig.authEnable === 1,
      qrcode: +res[WalnutAdminConstAppSettingKeys.APP_AUTH_QR as keyof typeof res] === 1,
      gitee: +giteeConfig.authEnable === 1,
      github: +githubConfig.authEnable === 1,
      google: +googleConfig.authEnable === 1,
      opaque: {
        enable: +opaqueConfig.authEnable === 1,
        register: +opaqueConfig.register === 1,
        forget: +opaqueConfig.forget === 1,
      },
    }
  }

  // get frontend settings
  async getFrontendSettings() {
    const res = await this.cacheAppSettingsService.getFunctionalFrontend()
    return {
      fullScreen: +res.fullScreen === 1,
      locale: +res.locale === 1,
      dark: +res.dark === 1,
      search: +res.search === 1,
    }
  }

  // get private settings
  async getPrivateSettings() {
    const frontendMaskUrl = await this.cacheAppSettingsService.getFunctionalFrontMaskUrl()
    const frontendHijackRefresh = await this.cacheAppSettingsService.getFunctionalFrontHijackRefresh()
    const frontendWatermark = await this.cacheAppSettingsService.getFunctionalFrontWatermark()
    const frontendTransition = await this.cacheAppSettingsService.getFunctionalFrontTransition()

    return {
      maskUrl: {
        status: frontendMaskUrl.status,
        mode: frontendMaskUrl.scope,
        value: frontendMaskUrl.globalValue,
      },
      hijackRefresh: {
        status: frontendHijackRefresh.status,
        mode: frontendHijackRefresh.scope,
        value: frontendHijackRefresh.globalValue,
      },
      watermark: {
        status: frontendWatermark.status,
        mode: frontendWatermark.scope,
        value: frontendWatermark.globalValue,
      },
      transition: {
        status: frontendTransition.status,
        mode: frontendTransition.scope,
        value: frontendTransition.globalValue,
      },
    }
  }
}
