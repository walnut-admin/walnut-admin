import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import {
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose, Transform } from 'class-transformer'
import { IsOptional } from 'class-validator'
import { Recordable } from 'easy-fns-ts'
import { CreateWalnutAdminRequestListDTO, CreateWalnutAdminResponseListDTO } from '@/common/dto/list.dto'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { WalnutAdminVirtualUserDTO } from '@/common/model/virtual/user'

/**
 * 回收站快照的出参脱敏键（F2，2026-10-28）。
 *
 * P2-18 修复后，用户删除会把 `sys_user_identity` / `sys_user_mfa` 整行快照进
 * `sys_deleted.content` —— 其中 `value`（口令/身份密文）、`totpSecretCiphertext`、
 * `webauthnPublicKey`、`phoneNumberCiphertext`、`backupCodesCiphertext` 是凭据材料。
 * 回收站 read / deleteMany 的响应会带 `content`（list 已 omit），必须在 DTO 层遮蔽；
 * 恢复走实体读取 `sys_deleted.content`，不经过 DTO，密文不受影响。
 */
export const WALNUT_DELETED_MASKED_CONTENT_KEYS = [
  'value',
  'totpSecretCiphertext',
  'webauthnPublicKey',
  'phoneNumberCiphertext',
  'backupCodesCiphertext',
] as const

/** 对快照 content 做浅层脱敏：命中敏感键且有值 → 替换为 `***`（不改原对象） */
export function maskDeletedSnapshotContent(content: Recordable | null | undefined): Recordable | null | undefined {
  if (content === null || content === undefined || typeof content !== 'object' || Array.isArray(content)) {
    return content
  }

  let masked: Recordable | null = null
  for (const key of WALNUT_DELETED_MASKED_CONTENT_KEYS) {
    if (!Object.hasOwn(content, key)) {
      continue
    }

    if (content[key] === null || content[key] === undefined) {
      continue
    }

    masked ??= { ...content }
    masked[key] = '***'
  }

  return masked ?? content
}

// 批 4 结构重构：schema/ 并入 dto/（原 schema/deleted.schema.ts 的 SysDeletedModel
// 改名 SysDeletedDTOBase），装饰器与字段本体零改动
export class SysDeletedDTOBase extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'Deleted Stringify Content',
      description: 'use `JSON.stringify` to store the deleted document',
    },
  })
  // B9 迁 PG（phase2 4.17）：列收 jsonb，应用侧直存对象（不再 stringify）。
  // 基座仅作 DTO 元数据保留，TS 注解随列型放开为对象（B8 同款，@Prop 无运行时语义）
  // F2：出参脱敏（identity / mfa 密文列 → `***`）；恢复链路不经过 DTO，不受影响
  @Transform(({ value }) => maskDeletedSnapshotContent(value as Recordable))
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

class SysDeletedDTO extends IntersectionType(SysDeletedDTOBase, WalnutAdminVirtualUserDTO) {
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
// L2 sort 白名单：admin 回收站排 modelName/collectionName/deletedAt（defaultSortOrder
// descend）。modelName 有 idx_deleted_model_at (model_name, deleted_at DESC) 首列
// 支撑、deletedAt 为同索引第二列；collectionName 无索引但 admin 在用 → 保留，见报告
// 建议补索引。实体无 created_at/updated_at（deletedAt 才是「入桶时间」）；admin 的
// user.userName 列服务端本就不支持排序（JOIN 别名未接 sort 通道），不收
export class SystemDeletedDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysDeletedDTOSafeRequest),
  { sortOnlyIn: ['modelName', 'collectionName', 'deletedAt'] },
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
