import type { IFontSizeConst } from '@walnut/contract/preference'
import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { Locale, LocaleType } from '@walnut/contract'

import { SysUserPreferenceDTOAccessibilityRequest, SysUserPreferenceDTOBasicRequest, SysUserPreferenceDTOLayoutRequest, SysUserPreferenceDTOThemeRequest, SysUserPreferenceResponseDTO } from '../dto/user_preference.dto'
import { SysUserPreferenceEntity } from '../entity/user-preference.entity'
import { colorModeConst, CVDConst, fontSizeConst, IColorModeConst, ICVDConst, ILayoutModeConst, layoutModeConst } from '../preference.const'
import { SysUserPreferenceBasicRepository } from '../user_preference.basic.repository'

/**
 * B7b 迁移 + **F-31 重构（裁决 Q6=b）：数据访问已下沉 repo** ——
 * 原先服务直持 `DataSource` + `getRepository(SysUserPreferenceEntity)`（B1 定案「原先无
 * repo 的模块随迁移补数据面」把这件事收口在服务里，绕过了「controller 级 service 不许触达
 * 数据层」的硬规矩）。现在数据面在同目录的 `SysUserPreferenceBasicRepository`
 * （三种 Repository 模式之一：同模块 CRUD = Basic Repository），本服务只做编排
 * （默认偏好组装 + 按 userId 分发）。
 *
 * 行为零变化（SQL 语义、em 透传、返回形状全部照旧，细节见仓库头注释）：
 * - `new Types.ObjectId(userId)` 包装全部摘除，uuid 直传（phase3-plan §4 B7 项）；
 * - 四个 `findOneAndUpdate(upsert)` 在仓库侧仍是 `INSERT ... ON CONFLICT (user_id)
 *   DO UPDATE`；bindPreferenceForUser 的 exists + create 语义原样保留；
 * - 事务句柄 em 仍逐层透传给仓库（缺省 = 连接级 manager）。
 */
@Injectable()
export class SysUserPreferenceService {
  constructor(
    private readonly prefBasicRepo: SysUserPreferenceBasicRepository,
  ) {}

  /**
   * @description bind preference for user, used for system
   */
  async bindPreferenceForUser(userId: string, em?: EntityManager) {
    if (await this.prefBasicRepo.existsByUserId(userId, em)) {
      return false
    }

    return this.prefBasicRepo.create({ userId }, em)
  }

  /**
   * @description get user preference
   */
  async getPreferenceForUser(userId: string, em?: EntityManager): Promise<SysUserPreferenceResponseDTO> {
    if (!userId) {
      return this.getDefaultPreference()
    }

    // get preference
    const preference = await this.prefBasicRepo.findByUserId(userId, em)

    if (!preference) {
      return this.getDefaultPreference()
    }

    return {
      basic: {
        locale: preference.locale as LocaleType,
      },
      accessibility: {
        fontSize: preference.fontSize as IFontSizeConst,
        reducedMotion: preference.reducedMotion,
        colorMode: preference.colorMode as IColorModeConst,
        // schema 侧 CVD 声明为 ICVDConst（default null 的历史宽松类型照抄，运行时可为 null）
        CVD: preference.CVD as ICVDConst,
      },
      theme: {
        dark: preference.dark,
      },
      layout: {
        layoutMode: preference.layoutMode as ILayoutModeConst,
        layout: preference.layout,
      },
    }
  }

  async updateBasic(userId: string, payload: SysUserPreferenceDTOBasicRequest, em?: EntityManager) {
    await this.prefBasicRepo.upsertByUserId(userId, payload, em)
    return true
  }

  async updateAccessibility(userId: string, payload: SysUserPreferenceDTOAccessibilityRequest, em?: EntityManager) {
    await this.prefBasicRepo.upsertByUserId(userId, payload, em)
    return true
  }

  async updateTheme(userId: string, payload: SysUserPreferenceDTOThemeRequest, em?: EntityManager) {
    await this.prefBasicRepo.upsertByUserId(userId, payload, em)
    return true
  }

  async updateLayout(userId: string, payload: SysUserPreferenceDTOLayoutRequest, em?: EntityManager) {
    // schema 侧 layout 是自由对象（object），实体侧收成 jsonb 的 Record<string, unknown>
    // —— cast 收口，运行时由驱动参数化
    await this.prefBasicRepo.upsertByUserId(userId, payload as unknown as Partial<SysUserPreferenceEntity>, em)
    return true
  }

  private getDefaultPreference(): SysUserPreferenceResponseDTO {
    return {
      basic: {
        locale: Locale.zh_CN,
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
}
