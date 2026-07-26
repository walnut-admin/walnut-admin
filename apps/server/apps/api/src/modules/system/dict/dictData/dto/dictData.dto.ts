import { IntersectionType } from '@nestjs/swagger'
import { WalnutAdminDecoratorFieldEnum } from '@walnut-server/decorators/field'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { IsOptional } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { SysDictDataModel, SysDictDataTagTypeConst, SysDictDataTagTypeConstType } from '../schema/dictData.schema'

export class SysDictDataDTO extends SysDictDataModel {
  constructor(partial?: Partial<SysDictDataDTO>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysDictDataDTOSafe extends RealOmitType(
  SysDictDataDTO,
  [] as const,
) {
  constructor(partial?: Partial<SysDictDataDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

class SysDictDataDTOSafeRequest extends RealPartialType(RealOmitType(SysDictDataDTOSafe, ['tagType'] as const)) {
  @WalnutAdminDecoratorFieldEnum(() => SysDictDataTagTypeConst, {
    isArray: true,
    default: SysDictDataTagTypeConst.PRIMARY,
    swaggerOptions: {
      title: 'dict data render tag type, see more in naive ui tag',
    },
  })
  @IsOptional({ each: true })
  tagType: SysDictDataTagTypeConstType
}

// list
export class SysDictDataDTOListRequest extends CreateWalnutAdminRequestListDTO(
  SysDictDataDTOSafeRequest,
) { }

export class SysDictDataDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysDictDataDTOSafe),
) { }

// create
export class SysDictDataDTOCreateRequest extends IntersectionType(RealPickType(
  SysDictDataDTOSafe,
  [
    'typeId',
    'label',
    'value',
    'tagType',
    'order',
    'status',
  ] as const,
), RealPartialType(RealPickType(SysDictDataDTOSafe, ['description'] as const))) { }
export class SysDictDataDTOCreateResponse extends SysDictDataDTOSafe { }

// read
export class SysDictDataDTOReadResponse extends SysDictDataDTOSafe { }

// update
export class SysDictDataDTOUpdateRequest extends IntersectionType(RealPickType(
  SysDictDataDTOSafe,
  [
    'typeId',
    'label',
    'value',
    'tagType',
    'order',
    'status',
  ] as const,
), RealPartialType(RealPickType(SysDictDataDTOSafe, ['description'] as const))) { }
export class SysDictDataDTOUpdateResponse extends SysDictDataDTOSafe { }

// delete
export class SysDictDataDTODeleteResponse extends SysDictDataDTOSafe { }

export class SysDictDataDTOPopulatedDictData extends RealPickType(SysDictDataDTOSafe, [
  'value',
  'label',
  'tagType',
  'order',
  '_id',
] as const) {
  constructor(partial?: Partial<SysDictDataDTOPopulatedDictData>) {
    super()
    Object.assign(this, partial)
  }
}
