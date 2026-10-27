import { ApiProperty } from '@nestjs/swagger'
import { IWalnutAdminConstDecoratorLogAuthType, WalnutAdminConstDecoratorLogAuthType } from '@walnut-server/const/decorator/logAuth'
import { WalnutAdminDecoratorFieldDate, WalnutAdminDecoratorFieldEnum } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealOmitType, RealPartialType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { SysLogAuthModel } from '../schema/log.auth.schema'

export class SysLogAuthDTO extends SysLogAuthModel {
  constructor(partial: Partial<SysLogAuthDTO>) {
    super()
    Object.assign(this, partial)
  }

  // B1 模板：PG 主键 id（uuid，phase2 4.15）—— @Expose 供响应序列化
  // （ClassSerializerInterceptor excludeExtraneousValues 只放行 Expose 字段）与
  // RealPickType/RealPartialType 的键枚举；入参不从这里进（主键只走路由参数的
  // uuid pipe），IsOptional 仅为 list 查询可选过滤
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string

  // B1 模板（IsMongoId → IsUUID）：子类重声明同名字段，class-validator 按
  // propertyName+type 去重、子类约束整体替换继承的 IsMongoId；松引用列可空
  // （登录失败时 NULL，phase2 4.15），nullable 与列型对齐
  @Expose()
  @ApiProperty({
    type: String,
    default: null,
    example: '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c',
  })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  declare userId: string | null
}

// Safe 层曾是「剔除 Mongo `_id`」的派生（B1 模板）；_id 已随 PG 迁移退役，现仅存名
export class SysLogAuthDTOSafe extends SysLogAuthDTO {
  constructor(partial?: Partial<SysLogAuthDTOSafe>) {
    super(partial ?? {})
  }
}

class SysLogAuthDTOSafeRequest extends RealPartialType(RealOmitType(SysLogAuthDTOSafe, ['type'] as const)) {
  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstDecoratorLogAuthType, {
    isArray: true,
    swaggerOptions: {
      title: 'auth type for request query, support array',
      example: WalnutAdminConstDecoratorLogAuthType.OPAQUE,
    },
  })
  @IsOptional({ each: true })
  type: IWalnutAdminConstDecoratorLogAuthType

  @WalnutAdminDecoratorFieldDate({
    isArray: true,
    swaggerOptions: {
      title: 'authenticatedAt for request query, support array',
      required: false,
    },
  })
  authenticatedAt: Date
}

// list
export class SysLogAuthDTOListRequest extends CreateWalnutAdminRequestListDTO(SysLogAuthDTOSafeRequest) { }

export class SysLogAuthDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysLogAuthDTOSafe),
) { }

// delete
export class SysLogAuthDTODeleteResponse extends SysLogAuthDTOSafe { }
