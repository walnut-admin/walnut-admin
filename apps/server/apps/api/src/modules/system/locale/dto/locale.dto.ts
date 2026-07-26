import { IntersectionType } from '@nestjs/swagger'
import {
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut/decorators/field'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut/utils/dto'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { SysLocaleModel } from '../schema/locale.schema'

export class SysLocaleDTO extends SysLocaleModel {
  constructor(partial: Partial<SysLocaleDTO>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysLocaleDTOSafe extends RealOmitType(SysLocaleDTO, [] as const) {
  constructor(partial?: Partial<SysLocaleDTOSafe>) {
    super()
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'translate process',
    },
    transformOptions: {
      res: {
        precision: 2,
      },
    },
  })
  process: number
}

// list
export class SysLocaleDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysLocaleDTOSafe),
) {}

export class SysLocaleDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(
    RealPickType(SysLocaleDTOSafe, [
      '_id',
      'key',
      'process',
      'createdAt',
      'updatedAt',
    ] as const),
  ),
) {}

// create
export class SysLocaleDTOCreateRequest extends IntersectionType(
  RealPickType(SysLocaleDTOSafe, [
    'langId',
    'key',
  ] as const),
  RealPartialType(RealPickType(SysLocaleDTOSafe, [
    'value',
  ] as const)),
) {}
export class SysLocaleDTOCreateResponse extends SysLocaleDTOSafe {}

// update
export class SysLocaleDTOUpdateRequest extends IntersectionType(
  RealPickType(SysLocaleDTOSafe, [
    'langId',
    'key',
  ] as const),
  RealPartialType(RealPickType(SysLocaleDTOSafe, [
    'value',
  ] as const)),
) {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'old key, used for to find in the db',
    },
  })
  oldKey: string
}
export class SysLocaleDTOUpdateResponse extends SysLocaleDTOSafe {}

// delete
export class SysLocaleDTODeleteResponse extends SysLocaleDTOSafe {}
