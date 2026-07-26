import { IntersectionType } from '@nestjs/swagger'
import { WalnutAdminDecoratorFieldDate } from '@walnut/decorators/field'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut/utils/dto'
import { IsOptional } from 'class-validator'
import { CreateWalnutAdminRequestListDTO, CreateWalnutAdminResponseListDTO } from '@/common/dto/list.dto'
import { WalnutAdminVirtualUserDTO } from '@/common/model/virtual/user'
import { SysDeletedModel } from '../schema/deleted.schema'

class SysDeletedDTO extends IntersectionType(SysDeletedModel, WalnutAdminVirtualUserDTO) {
  constructor(partial: Partial<SysDeletedDTO>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysDeletedDTOSafe extends RealOmitType(
  SysDeletedDTO,
  [] as const,
) {
  constructor(partial?: Partial<SysDeletedDTOSafe>) {
    super()
    Object.assign(this, partial)
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
  ['_id', 'deletedId'] as const,
) { }
