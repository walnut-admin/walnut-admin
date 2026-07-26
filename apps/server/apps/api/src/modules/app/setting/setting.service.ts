import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'

import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'

import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'

import {
  AppSettingDTOCreateRequest,
  AppSettingDTOListRequest,
  AppSettingDTOUpdateRequest,
} from './dto/setting.dto'
import { AppSettingRepositoryService } from './repo/setting.repo.service'
import { IAppSettingModel } from './schema/setting.schema'
import { AppSettingBasicRepository } from './setting.basic.repository'

@Injectable()
export class AppSettingService {
  private readonly logger = new Logger(AppSettingService.name)

  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.APP_SETTING)
    private readonly appSettingModel: IAppSettingModel,

    private readonly settingBasicRepo: AppSettingBasicRepository,
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
    private readonly settingRepoService: AppSettingRepositoryService,
  ) {}

  // base CRUD
  async create(dto: AppSettingDTOCreateRequest) {
    const created = await this.settingBasicRepo.create(dto)

    // re-extract app setting after create
    await this.settingRepoService.extractAppSettingIntoCache()

    return created
  }

  async read(id: string) {
    return this.settingBasicRepo.readById(id)
  }

  async update(id: string, dto: AppSettingDTOUpdateRequest) {
    const updated = await this.settingBasicRepo.update(id, dto)

    // re-extract app setting after update
    await this.settingRepoService.extractAppSettingIntoCache()

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
