import { WalnutAdminDecoratorFieldDate } from '@walnut-server/decorators/field'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'

// HINT
// Since TypeScript does not store metadata about generics or interfaces,
// when you use them in your DTOs,
// ValidationPipe may not be able to properly validate incoming data.
// For this reason, consider using concrete classes in your DTOs.
// HINT
// When importing your DTOs,
// you can't use a type-only import as that would be erased at runtime,
// i.e. remember to import { CreateUserDto }
// instead of  import { CreateUserDto }

/**
 * DTO 元数据基座（Phase 5a 起无 mongoose 装饰）：Mongo 的 `_id` 已随 PG 迁移彻底退役
 * （PG 实体以 `id`（uuid）为唯一标识，Safe 层不再需要 omit），仅保留 Expose 序列化
 * 元数据；createdAt/updatedAt 供响应序列化继承。
 */
export class WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'default createdAt',
      description:
        // TODO how did i exclude this field when request?
        'If you change the field name of createdAt through the schema configuration, omit the prop and declare your own time field. It is optional and eliminated when entering the parameter to prevent this field from being changed by mistake when modifying',
      required: false,
    },
  })
  @IsOptional({})
  @Expose({})
  createdAt?: Date

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'default updatedAt',
      description:
        'If you change the field name of updatedAt through the schema configuration, omit the prop and declare your own time field. It is optional and eliminated when entering the parameter to prevent this field from being changed by mistake when modifying',
      required: false,
    },
  })
  @IsOptional({})
  @Expose({})
  updatedAt?: Date
}
