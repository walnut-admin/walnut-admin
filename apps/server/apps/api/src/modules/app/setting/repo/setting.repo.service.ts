import { Injectable } from '@nestjs/common'
import { WalnutAdminConstAppCacheType } from '@walnut/const/app/cache'
import { runAfterCommit, WalnutDBInjectModel, WalnutDBModelName } from '@walnut/db'
import { ClientSession } from 'mongoose'

import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'
import { IAppSettingModel } from '../schema/setting.schema'

@Injectable()
export class AppSettingRepositoryService {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.APP_SETTING)
    private readonly SettingModel: IAppSettingModel,

    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
  ) {}

  // extract all app setting into cache
  async extractAppSettingIntoCache() {
    const allAppSettings = await this.SettingModel.find()

    const dataToCache = Object.fromEntries(
      allAppSettings.map(i => [i.settingKey, i.settingValue]),
    )

    await this.cacheAppSettingsService.setAppSettings(dataToCache, {
      t: WalnutAdminConstAppCacheType.BUILT_IN,
    })

    return allAppSettings.length
  }

  /**
   * @description find app setting by key
   */
  async findAppSettingByKey<T>(key: string, dbSession?: ClientSession): Promise<T | null> {
    const doc = await this.SettingModel.findOne({ settingKey: key }).session(dbSession!)
    return doc && Reflect.has(doc, 'settingValue') ? JSON.parse(doc.settingValue) as T : null
  }

  /**
   * @description update app setting by key
   */
  async updateAppSettingByKey(key: string, value: string, dbSession?: ClientSession) {
    await this.SettingModel.findOneAndUpdate({ settingKey: key }, { settingValue: value }).session(dbSession!)

    // extract app setting into cache after transaction commit
    await runAfterCommit(async () => {
      await this.extractAppSettingIntoCache()
    })
  }
}
