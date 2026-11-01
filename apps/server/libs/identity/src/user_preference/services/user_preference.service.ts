import type { IFontSizeConst } from '@walnut/contract/preference'
import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { Locale, LocaleType } from '@walnut/contract'
import { DataSource } from 'typeorm'

import { SysUserPreferenceDTOAccessibilityRequest, SysUserPreferenceDTOBasicRequest, SysUserPreferenceDTOLayoutRequest, SysUserPreferenceDTOThemeRequest, SysUserPreferenceResponseDTO } from '../dto/user_preference.dto'
import { SysUserPreferenceEntity } from '../entity/user-preference.entity'
import { colorModeConst, CVDConst, fontSizeConst, IColorModeConst, ICVDConst, ILayoutModeConst, layoutModeConst } from '../preference.const'

/**
 * B7b 迁移：Mongo model 直持 → PG 命名连接 DataSource（本模块无独立仓库，
 * 服务即数据面；B1 定案「原先无 repo 的模块随迁移补数据面」——服务直持 DataSource
 * 即承接，避免为一个消费者再垫一层）。
 *
 * - `new Types.ObjectId(userId)` 包装全部摘除，uuid 直传（phase3-plan §4 B7 项）；
 * - 四个 `findOneAndUpdate(upsert)` → `INSERT ... ON CONFLICT (user_id) DO UPDATE`
 *   （B6 upsertDevice 同款 QueryBuilder orUpdate 手法；user_id 有 uq_user_preference_user
 *   UNIQUE，冲突目标唯一）。部分列插入未提供的列走 DB 默认值，对齐 Mongo upsert 的
 *   schema 默认值语义；冲突路径只回写本次 payload 携带的列；
 * - bindPreferenceForUser 的 exists + create 语义原样保留。
 */
@Injectable()
export class SysUserPreferenceService {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,
  ) {}

  private getManager(em?: EntityManager) {
    return em ?? this.dataSource.manager
  }

  private getRepository(em?: EntityManager) {
    return this.getManager(em).getRepository(SysUserPreferenceEntity)
  }

  private getPropertyColumnName(property: string): string {
    const metadata = this.dataSource.getMetadata(SysUserPreferenceEntity)
    const column = metadata.findColumnWithPropertyPath(property)
    return column?.databaseName ?? property
  }

  /**
   * findOneAndUpdate({ userId }, payload, { upsert: true }) 的 PG 版：
   * ON CONFLICT (user_id) DO UPDATE（只回写 payload 携带的列），未提供列两边都走默认值。
   * payload 为空对象时 Mongo 版只做首插，PG 版对应 ON CONFLICT DO NOTHING（orIgnore）。
   */
  private async upsertPreferenceForUser(userId: string, payload: Partial<SysUserPreferenceEntity>, em?: EntityManager) {
    const overwriteColumns = Object.keys(payload)
      .filter(k => k !== 'userId' && payload[k as keyof SysUserPreferenceEntity] !== undefined)
      .map(k => this.getPropertyColumnName(k))

    const query = this.getManager(em)
      .createQueryBuilder()
      .insert()
      .into(SysUserPreferenceEntity)
      // QueryDeepPartialEntity 表达不了 jsonb 自由对象（layout 状态袋），实体直塞由
      // 驱动参数化 —— cast 收口
      .values({ userId, ...payload } as never)

    if (overwriteColumns.length > 0) {
      await query.orUpdate(overwriteColumns, ['user_id']).execute()
    }
    else {
      await query.orIgnore().execute()
    }
  }

  /**
   * @description bind preference for user, used for system
   */
  async bindPreferenceForUser(userId: string, em?: EntityManager) {
    if (await this.getRepository(em).exists({ where: { userId } })) {
      return false
    }

    return this.getRepository(em).save(this.getRepository(em).create({ userId }))
  }

  /**
   * @description get user preference
   */
  async getPreferenceForUser(userId: string, em?: EntityManager): Promise<SysUserPreferenceResponseDTO> {
    if (!userId) {
      return this.getDefaultPreference()
    }

    // get preference
    const preference = await this.getRepository(em).findOne({
      where: { userId },
    })

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
    await this.upsertPreferenceForUser(userId, payload, em)
    return true
  }

  async updateAccessibility(userId: string, payload: SysUserPreferenceDTOAccessibilityRequest, em?: EntityManager) {
    await this.upsertPreferenceForUser(userId, payload, em)
    return true
  }

  async updateTheme(userId: string, payload: SysUserPreferenceDTOThemeRequest, em?: EntityManager) {
    await this.upsertPreferenceForUser(userId, payload, em)
    return true
  }

  async updateLayout(userId: string, payload: SysUserPreferenceDTOLayoutRequest, em?: EntityManager) {
    // schema 侧 layout 是自由对象（object），实体侧收成 jsonb 的 Record<string, unknown>
    // —— cast 收口，运行时由驱动参数化
    await this.upsertPreferenceForUser(userId, payload as unknown as Partial<SysUserPreferenceEntity>, em)
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
