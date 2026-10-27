import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import { WalnutAdminDecoratorFieldDate } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import { CreateWalnutAdminRequestListDTO, CreateWalnutAdminResponseListDTO } from '@/common/dto/list.dto'
import { WalnutAdminVirtualUserDTO } from '@/common/model/virtual/user'
import { SysDeletedModel } from '../schema/deleted.schema'

class SysDeletedDTO extends IntersectionType(SysDeletedModel, WalnutAdminVirtualUserDTO) {
  constructor(partial: Partial<SysDeletedDTO>) {
    super()
    Object.assign(this, partial)
  }

  // B1 模板：PG 主键 id（uuid，phase2 4.17）—— @Expose 供响应序列化与
  // RealPickType/RealPartialType 的键枚举；IsOptional 仅为 list 查询可选过滤
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string

  // B1 模板（IsMongoId → IsUUID）：子类重声明同名字段，class-validator 按
  // propertyName+type 去重、子类约束整体替换继承的 IsMongoId
  @Expose()
  @ApiProperty({
    type: String,
    example: '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c',
  })
  @WalnutAdminDecoratorValidatorUuid()
  declare deletedId: string

  @Expose()
  @ApiProperty({
    type: String,
    example: '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c',
  })
  @WalnutAdminDecoratorValidatorUuid()
  declare deletedBy: string

  // 松引用可空（phase2 4.17 log_operate_id NULL YES）
  @Expose()
  @ApiProperty({
    type: String,
    default: null,
    nullable: true,
    example: '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c',
  })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  declare logOperateId?: string | null
}

// Safe 层曾是「剔除 Mongo `_id`」的派生（B1 模板）；_id 已随 PG 迁移退役，现仅存名
export class SysDeletedDTOSafe extends SysDeletedDTO {
  constructor(partial?: Partial<SysDeletedDTOSafe>) {
    super(partial ?? {})
  }
}

class SysDeletedDTOSafeRequest extends RealPartialType(RealOmitType(SysDeletedDTOSafe, ['deletedAt'] as const)) {
  @WalnutAdminDecoratorFieldDate({
    isArray: true,
    swaggerOptions: {
      title: 'deletedAt for request query, support array',
      required: false,
    },
  })
  @IsOptional({ each: true })
  deletedAt: Date
}

// list
export class SystemDeletedDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysDeletedDTOSafeRequest),
) {}

export class SystemDeletedDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealOmitType(RealPartialType(SysDeletedDTOSafe), ['content'] as const),
) {}

// read
export class SystemDeletedDTOReadResponse extends SysDeletedDTOSafe {}

// delete
export class SystemDeletedDTODeleteResponse extends SysDeletedDTOSafe {}

// recover
export class SysDeletedDTORecoverRequest extends RealPickType(
  SysDeletedDTOSafe,
  ['id', 'deletedId'] as const,
) {
  // 恢复定位键必填（子类重声明收紧 IsOptional：缺省 id 不允许落到条件为空的
  // findOne 上）；deletedId 的必填 uuid 约束继承自 DTOSafe
  @Expose()
  @ApiProperty({ required: true })
  @WalnutAdminDecoratorValidatorUuid()
  declare id: string
}
