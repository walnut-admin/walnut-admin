import {
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { Expose } from 'class-transformer'
import { Recordable } from 'easy-fns-ts'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export class SysDeletedModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'Deleted Stringify Content',
      description: 'use `JSON.stringify` to store the deleted document',
    },
  })
  // B9 迁 PG（phase2 4.17）：列收 jsonb，应用侧直存对象（不再 stringify）。
  // schema 仅作 DTO 元数据基座保留，TS 注解随列型放开为对象（B8 同款，@Prop 无运行时语义）
  content: Recordable

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'Deleted Document Model Name',
      description: 'use `modelName` to ensure the right model',
    },
  })
  modelName: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'Deleted Document Collection Name',
      description: 'use `modelName` to recover, this field is only a record',
    },
  })
  collectionName: string

  @Expose()
  // B9 迁 PG：uuid 列，注解随列型放开为 string（uuid 校验在 DTO 子类重声明）
  deletedId: string

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'Deleted time',
      description: 'which means `createdAt`',
    },
  })
  deletedAt?: Date

  @Expose()
  // B9 迁 PG：uuid 松引用（Q3：删除者自己也可能被删，不建 FK），注解放开为 string
  deletedBy: string

  @Expose()
  // B9 迁 PG：uuid 松引用可空（logOperateId 回填见 SysDeletedPgRepoService）
  logOperateId?: string | null
}
