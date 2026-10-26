import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { Expose } from 'class-transformer'
import { ValueOf } from 'easy-fns-ts'

import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export const SysDictDataTagTypeConst = {
  PRIMARY: 'primary',
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
} as const

export type SysDictDataTagTypeConstType = ValueOf<typeof SysDictDataTagTypeConst>

/**
 * B3 迁移后仅作为 DTO 元数据基座保留（模型注册已随迁移从 dictData.module /
 * dictType.module 摘除，@Prop 不再有运行时语义）；PG 列型见 entity/dict-data.entity.ts。
 */
export class SysDictDataModel extends WalnutAdminCommonBasicModel {
  @Expose()
  // B3：TS 类型随 PG 列型放开为 string（uuid FK，phase2 4.7），uuid 校验在 DTO 子类接管
  typeId: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'dict data label',
      required: true,
    },
  })
  label: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'dict data value',
      required: true,
    },
  })
  value: string

  @WalnutAdminDecoratorFieldNumber({
    default: 0,
    swaggerOptions: {
      title: 'dict data order in array',
    },
    validateOptions: {
      int: true,
    },
  })
  order: number

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'dict data status, false will not be extracted',
    },
  })
  status: boolean

  @WalnutAdminDecoratorFieldEnum(() => SysDictDataTagTypeConst, {
    default: SysDictDataTagTypeConst.PRIMARY,
    swaggerOptions: {
      title: 'dict data render tag type, see more in naive ui tag',
    },
  })
  tagType: SysDictDataTagTypeConstType

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'dict data description',
    },
  })
  description: string
}
