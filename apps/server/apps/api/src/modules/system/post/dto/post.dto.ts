import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import {
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { ISysPostStatus, SysPostStatusConst } from '../post.const'

/** 岗位 DTO 基座 ↔ `SysPostEntity` 逐字段对应（平表，无树） */
export class SysPostDTOBase extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'post code',
      description: 'unique business key',
    },
    validateOptions: { maxLen: 64 },
  })
  postCode: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'post name',
    },
  })
  postName: string

  @WalnutAdminDecoratorFieldNumber({
    default: 0,
    swaggerOptions: {
      title: 'sort order',
      description: 'should be int',
    },
    validateOptions: { int: true },
  })
  sortOrder: number

  @WalnutAdminDecoratorFieldEnum(() => SysPostStatusConst, {
    default: SysPostStatusConst.ENABLED,
    swaggerOptions: {
      title: 'post status',
      description: 'disabled => not selectable in new assignments, existing rows stay',
      example: SysPostStatusConst.ENABLED,
    },
  })
  status: ISysPostStatus

  @WalnutAdminDecoratorFieldString({
    default: null,
    validateOptions: { nullable: true },
    swaggerOptions: { title: 'remark', nullable: true },
  })
  remark: string | null
}

export class SysPostDTO extends SysPostDTOBase {
  constructor(partial?: Partial<SysPostDTO>) {
    super()
    Object.assign(this, partial)
  }

  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string
}

export class SysPostDTOSafe extends SysPostDTO {
  constructor(partial?: Partial<SysPostDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysPostDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysPostDTOSafe),
  { sortOnlyIn: ['postCode', 'postName', 'sortOrder', 'status', 'createdAt', 'updatedAt'] },
) {}

export class SysPostDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysPostDTOSafe),
) {}

// create：postCode / postName / status 必填
export class SysPostDTOCreateRequest extends IntersectionType(
  RealPickType(SysPostDTOSafe, ['postCode', 'postName', 'status'] as const),
  RealPartialType(RealPickType(SysPostDTOSafe, ['sortOrder', 'remark'] as const)),
) {}
export class SysPostDTOCreateResponse extends SysPostDTOSafe {}

export class SysPostDTOReadResponse extends SysPostDTOSafe {}

// update：与 create 同形 —— PUT 是整体替换（可选字段缺省即清空）
export class SysPostDTOUpdateRequest extends IntersectionType(
  RealPickType(SysPostDTOSafe, ['postCode', 'postName', 'status'] as const),
  RealPartialType(RealPickType(SysPostDTOSafe, ['sortOrder', 'remark'] as const)),
) {}
export class SysPostDTOUpdateResponse extends SysPostDTOSafe {}

export class SysPostDTODeleteResponse extends SysPostDTOSafe {}
