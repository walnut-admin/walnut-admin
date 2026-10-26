import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { LocaleType } from '@walnut/contract'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

/**
 * B2 迁移后仅作为 DTO 元数据基座保留（模型注册已随迁移从 lang.module /
 * lang.repo.module 摘除，@Prop/@Virtual 不再有运行时语义）；PG 列型见 entity/lang.entity.ts，
 * 两个 locale 计数 virtual 在 PG 侧改为相关子查询（repo 层，phase2 5.2）。
 */
export class SysLangModel extends WalnutAdminCommonBasicModel {
  /**
   * @description how to remove indexes in mongodb
   * @link https://stackoverflow.com/questions/12337388/mongodb-remove-unique-constraint
   */
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'language short',
    },
  })
  lang: LocaleType

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'language describe',
    },
  })
  description: string

  @WalnutAdminDecoratorFieldNumber({
    default: null,
    swaggerOptions: {
      title: 'language order',
      description: 'should be int',
    },
    validateOptions: { int: true },
  })
  order: number

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'language is in use or not',
    },
  })
  status: boolean

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: `current lang's locales total count`,
    },
  })
  populated_localesTotalCount: number

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: `current lang's locales finished count`,
    },
  })
  populated_localesFinishedCount: number
}
