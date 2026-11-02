import { ApiProperty } from '@nestjs/swagger'

import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { SysUserIdentityDTO } from '@walnut-server/identity'
import { CreateWalnutAdminResponseListDTO } from '@walnut-server/list'
import { RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'

/**
 * F-03（批次1-B，2026-10-30）：`POST system/user/identity/list` 的专用 wire 响应面。
 *
 * 旧行为：controller 直返 service 的 `{ data: 实体数组, total }`，行实体
 * （SysUserIdentityEntity）无任何 @Expose，被全局 ClassSerializerInterceptor
 * （excludeExtraneousValues: true）在出站剥成 `[{}]`，与 swagger 声明的
 * `SysUserIdentityDTO isArray` 双重不符。
 *
 * 修法（AppMonitorUserController.list 同款手法）：controller 补
 * `plainToInstance(SysUserIdentityListResponseDTO, …)`；行 DTO 用仓库包装
 * RealPickType 从 SysUserIdentityDTO 挑**安全字段子集** —— `value`（AES-256-GCM
 * 密文）与 `valueHash`（HMAC 查找键）两个密文面字段被剔除，永不出 wire。
 */
export class SysUserIdentityListItemDTO extends RealPickType(SysUserIdentityDTO, [
  'userId',
  'type',
  'purpose',
  'maskedValue',
  'verified',
  'verifiedAt',
  'isPrimary',
  'status',
  'metadata',
  'createdAt',
  'updatedAt',
] as const) {
  // userId 在基座只有 @Expose 无 ApiProperty —— swagger 面一直缺列；行 wire 真实携带
  // （spec 断言其值 = token 用户），子类重声明补齐文档面（SysUserDTO 同名重声明同款
  // idiom，class-validator 按 propertyName 去重）
  @Expose()
  @ApiProperty({ type: String })
  @WalnutAdminDecoratorValidatorUuid()
  userId: string

  // PG 主键 id（uuid，phase2 4.10）：实体是 POJO 无元数据、SysUserIdentityDTO 链上无 id
  // 声明 —— 在 wire 行 DTO 头部补声明（@Expose 供响应序列化，缺了它响应不带 id；
  // SysUserDTO 的 id 同款 idiom，uuid 校验不锁版本）
  @Expose()
  @ApiProperty({ type: String })
  @WalnutAdminDecoratorValidatorUuid()
  id: string
}

// list response：{ data: SysUserIdentityListItemDTO[], total }（对齐真实 wire 壳，
// 替换旧装饰器的 isArray 直数组声明）
export class SysUserIdentityListResponseDTO extends CreateWalnutAdminResponseListDTO(
  SysUserIdentityListItemDTO,
) {
  constructor(partial?: Partial<SysUserIdentityListResponseDTO>) {
    super()
    Object.assign(this, partial)
  }
}
