import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldObject,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { SysDictDataDTOPopulatedDictData } from '../../dictData/dto/dictData.dto'

/**
 * B3 迁移后仅作为 DTO 元数据基座保留（模型注册已随迁移从 dictType.module 摘除，
 * @Prop/@Virtual 不再有运行时语义）；PG 列型见 entity/dict-type.entity.ts，
 * populated_dictData / populated_dictDataCount 两个 virtual 在 PG 侧改为相关子查询
 * （dictType.basic.repository 的 list 覆写 / getByType 的两次取数）。
 */
export class SysDictTypeModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'dict name',
      required: true,
    },
  })
  name: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'dict type or can be treated as dict key',
      required: true,
    },
  })
  type: string

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'dict status',
    },
  })
  status: boolean

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'description',
    },
  })
  description: string

  // virtual
  @WalnutAdminDecoratorFieldObject(SysDictDataDTOPopulatedDictData, {
    swaggerOptions: {
      title: 'populated dict data',
    },
  })
  populated_dictData?: SysDictDataDTOPopulatedDictData

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: `populated dict data count`,
    },
  })
  populated_dictDataCount?: number
}
