import { ApiProperty } from '@nestjs/swagger'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import { AppKeyModel } from '../schema/key.schema'

export class AppKeyDTO extends AppKeyModel {
  constructor(partial?: Partial<AppKeyDTO>) {
    super()
    Object.assign(this, partial)
  }

  // PG 主键 id（uuid，phase2 4.23）：B1 模板 —— @Expose 供响应序列化与
  // RealPickType/RealPartialType 的键枚举；本模块无 list/路由 id 入参
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string
}

// Safe 层曾是「剔除 Mongo `_id`」的派生（B1 模板）；_id 已随 PG 迁移退役，现仅存名
export class AppKeyDTOSafe extends AppKeyDTO {
  constructor(partial?: Partial<AppKeyDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

export class AppKeyDTOInit extends RealPickType(AppKeyDTOSafe, ['type'] as const) {
  constructor(partial: Partial<AppKeyDTOInit>) {
    super()
    Object.assign(this, partial)
  }
}
