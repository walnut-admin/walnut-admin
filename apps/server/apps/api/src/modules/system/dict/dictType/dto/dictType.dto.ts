import { IntersectionType } from '@nestjs/swagger'
import { WalnutAdminDecoratorFieldObject } from '@walnut/decorators/field/object.decorator'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut/utils/dto'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { SysDictDataDTOPopulatedDictData } from '../../dictData/dto/dictData.dto'
import { SysDictTypeModel } from '../schema/dictType.schema'

export class SysDictTypeDTO extends SysDictTypeModel {
  constructor(partial?: Partial<SysDictTypeDTO>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysDictTypeDTOSafe extends RealOmitType(
  SysDictTypeDTO,
  [] as const,
) {
  constructor(partial?: Partial<SysDictTypeDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

// list
export class SysDictTypeDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysDictTypeDTOSafe),
) { }

export class SysDictTypeDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysDictTypeDTOSafe),
) { }

// create
export class SysDictTypeDTOCreateRequest extends IntersectionType(RealPickType(
  SysDictTypeDTOSafe,
  ['type', 'name', 'status'] as const,
), RealPartialType(RealPickType(
  SysDictTypeDTOSafe,
  ['description'] as const,
))) { }
export class SysDictTypeDTOCreateResponse extends SysDictTypeDTOSafe { }

// read
export class SysDictTypeDTOReadResponse extends SysDictTypeDTOSafe { }

// update
export class SysDictTypeDTOUpdateRequest extends IntersectionType(RealPickType(
  SysDictTypeDTOSafe,
  ['type', 'name', 'status'] as const,
), RealPartialType(RealPickType(
  SysDictTypeDTOSafe,
  ['description'] as const,
))) { }
export class SysDictTypeDTOUpdateResponse extends SysDictTypeDTOSafe { }

// delete
export class SysDictTypeDTODeleteResponse extends SysDictTypeDTOSafe { }

// get by type
export class SysDictTypeDTOWithDictDataResponse extends RealPickType(
  SysDictTypeDTOSafe,
  ['type', 'name'] as const,
) {
  constructor(partial?: Partial<SysDictTypeDTOWithDictDataResponse>) {
    super()
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldObject(SysDictDataDTOPopulatedDictData, {
    isArray: true,
    swaggerOptions: {
      title: 'dict data with dict type',
    },
  })
  dictData: SysDictDataDTOPopulatedDictData[]
}
