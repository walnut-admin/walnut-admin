import { ApiProperty } from '@nestjs/swagger'
import { IWalnutAdminConstAppHTTPMethods, WalnutAdminConstAppHTTPMethods } from '@walnut-server/const/app/methods'
import { IWalnutAdminConstDecoratorLogOperateAction, IWalnutAdminConstDecoratorLogOperateType, WalnutAdminConstDecoratorLogOperateAction, WalnutAdminConstDecoratorLogOperateType } from '@walnut-server/const/decorator/logOperate'
import { WalnutAdminDecoratorFieldDate, WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { SysLogOperateModel } from '../schema/log.operate.schema'

export class SysLogOperateDTO extends SysLogOperateModel {
  constructor(partial: Partial<SysLogOperateDTO>) {
    super()
    Object.assign(this, partial)
  }

  // B1 模板：PG 主键 id（uuid，phase2 4.16）—— @Expose 供响应序列化
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
  // （phase2 4.16 user_id NULL YES），nullable 与列型对齐
  @Expose()
  @ApiProperty({
    type: String,
    default: null,
    example: '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c',
  })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  declare userId: string | null
}

export class SysLogOperateDTOSafe extends RealOmitType(
  SysLogOperateDTO,
  // B1 模板：Safe 层剔除 Mongo `_id`（PG 响应以 id 为唯一标识）
  ['snapshotBefore', 'snapshotAfter', '_id'] as const,
) {
  constructor(partial?: Partial<SysLogOperateDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

class SysLogOperateDTOSafeRequest extends RealPartialType(RealOmitType(SysLogOperateDTOSafe, ['actionType', 'operation', 'operatedAt', 'method'] as const)) {
  @WalnutAdminDecoratorFieldString({
    isArray: true,
    swaggerOptions: {
      title: 'actionType for request query, support array',
    },
    validateOptions: {
      onlyIn: [...Object.values(WalnutAdminConstDecoratorLogOperateAction)],
    },
  })
  @IsOptional({ each: true })
  actionType: IWalnutAdminConstDecoratorLogOperateAction

  @WalnutAdminDecoratorFieldString({
    isArray: true,
    swaggerOptions: {
      title: 'operation for request query, support array',
    },
    validateOptions: {
      onlyIn: [...Object.values(WalnutAdminConstDecoratorLogOperateType)],
    },
  })
  @IsOptional({ each: true })
  operation: IWalnutAdminConstDecoratorLogOperateType

  @WalnutAdminDecoratorFieldDate({
    isArray: true,
    swaggerOptions: {
      title: 'operatedAt for request query, support array',
      required: false,
    },
  })
  @IsOptional({ each: true })
  operatedAt: Date

  @WalnutAdminDecoratorFieldString({
    isArray: true,
    swaggerOptions: {
      title: 'http method for request query, support array',
    },
    validateOptions: {
      onlyIn: [...Object.values(WalnutAdminConstAppHTTPMethods)],
    },
  })
  @IsOptional({ each: true })
  method: IWalnutAdminConstAppHTTPMethods
}

// list
export class SysLogOperateDTOListRequest extends CreateWalnutAdminRequestListDTO(SysLogOperateDTOSafeRequest) { }

export class SysLogOperateDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysLogOperateDTOSafe),
) { }

// read
export class SysLogOperateDTOReadResponse extends SysLogOperateDTOSafe { }

// snapshot
export class SysLogOperateDTOSnapshotResponse extends RealPickType(
  SysLogOperateDTO,
  ['snapshotBefore', 'snapshotAfter'] as const,
) {
  constructor(partial?: Partial<SysLogOperateDTOSnapshotResponse>) {
    super()
    Object.assign(this, partial)
  }
}
