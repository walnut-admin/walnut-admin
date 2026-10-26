import { WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'

import { Expose } from 'class-transformer'

import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

/**
 * B2 迁移后仅作为 DTO 元数据基座保留（模型注册已随迁移从 locale.module /
 * locale.repo.module / locale.shared.module 摘除，@Prop 不再有运行时语义）；
 * PG 列型见 entity/locale.entity.ts —— langId 由 ObjectId 放开为 uuid 字符串
 * （phase2 4.5），uuid 校验在 DTO 子类重声明接管。
 */
export class SysLocaleModel extends WalnutAdminCommonBasicModel {
  @Expose()
  // B2：TS 类型随 PG 列型放开为 string（uuid），校验在 DTO 子类接管
  langId: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      required: true,
      title: 'i18n key',
    },
  })
  key: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'i18n value',
    },
    validateOptions: {
      nullable: true,
    },
  })
  value: string
}
