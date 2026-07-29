import { Injectable } from '@nestjs/common'
import { LocaleType, LocaleType } from '@walnut/contract'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { Types } from 'mongoose'

import { SysUserPreferenceDTOAccessibilityRequest, SysUserPreferenceDTOBasicRequest, SysUserPreferenceDTOLayoutRequest, SysUserPreferenceDTOThemeRequest, SysUserPreferenceResponseDTO } from '../dto/user_preference.dto'
import { colorModeConst, CVDConst, fontSizeConst, ISysUserPreferenceModel, layoutModeConst } from '../schema/user_preference.schema'

@Injectable()
export class SysUserPreferenceService {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_USER_PREFERENCE)
    private readonly SysUserPreferenceModel: ISysUserPreferenceModel,
  ) {}

  private getDefaultPreference(): SysUserPreferenceResponseDTO {
    return {
      basic: {
        locale: LocaleType.zh_CN,
      },
      accessibility: {
        fontSize: fontSizeConst[14],
        reducedMotion: false,
        colorMode: colorModeConst.DEFAULT,
        CVD: CVDConst.DEFAULT,
      },
      theme: {
        dark: false,
      },
      layout: {
        layoutMode: layoutModeConst.LEFT_MENU,
        layout: {
          header: {
            inverted: true,
          },
          tabs: {
            inverted: true,
            showIcon: true,
            styleMode: 'card',
            closeMode: 'hover',
            affixMode: 'icon',
          },
          breadcrumb: {
            showIcon: true,
            showDropdown: true,
          },
          menu: {
            inverted: true,
            collapseMode: 'bar',
          },
          footer: {
            inverted: true,
          },
        },
      },
    }
  }

  /**
   * @description bind preference for user, used for system
   */
  async bindPreferenceForUser(userId: string) {
    if (await this.SysUserPreferenceModel.exists({ userId: new Types.ObjectId(userId) })) {
      return false
    }

    const payload = {
      userId: new Types.ObjectId(userId),
    }

    return this.SysUserPreferenceModel.create(payload)
  }

  /**
   * @description get user preference
   */
  async getPreferenceForUser(userId: string): Promise<SysUserPreferenceResponseDTO> {
    if (!userId) {
      return this.getDefaultPreference()
    }

    const objId = new Types.ObjectId(userId)

    // get preference
    const preference = await this.SysUserPreferenceModel.findOne({
      userId: objId,
    })

    if (!preference) {
      return this.getDefaultPreference()
    }

    return {
      basic: {
        locale: preference.locale,
      },
      accessibility: {
        fontSize: preference.fontSize,
        reducedMotion: preference.reducedMotion,
        colorMode: preference.colorMode,
        CVD: preference.CVD,
      },
      theme: {
        dark: preference.dark,
      },
      layout: {
        layoutMode: preference.layoutMode,
        layout: preference.layout,
      },
    }
  }

  async updateBasic(userId: string, payload: SysUserPreferenceDTOBasicRequest) {
    await this.SysUserPreferenceModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId) },
      payload,
      { upsert: true },
    )
    return true
  }

  async updateAccessibility(userId: string, payload: SysUserPreferenceDTOAccessibilityRequest) {
    await this.SysUserPreferenceModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId) },
      payload,
      { upsert: true },
    )
    return true
  }

  async updateTheme(userId: string, payload: SysUserPreferenceDTOThemeRequest) {
    await this.SysUserPreferenceModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId) },
      payload,
      { upsert: true },
    )
    return true
  }

  async updateLayout(userId: string, payload: SysUserPreferenceDTOLayoutRequest) {
    await this.SysUserPreferenceModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId) },
      payload,
      { upsert: true },
    )
    return true
  }
}
