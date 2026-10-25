import { ApiProperty } from '@nestjs/swagger'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealOmitType, RealPickType } from '@walnut-server/utils/dto'
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

// Safe 层剔除 Mongo 的 _id（B1 模板：PG 响应以 id 为唯一标识，_id 在 PG 实体上不存在）
export class AppKeyDTOSafe extends RealOmitType(AppKeyDTO, ['_id'] as const) {
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
