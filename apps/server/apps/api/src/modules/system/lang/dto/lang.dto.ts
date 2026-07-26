import { WalnutAdminDecoratorFieldNumber } from '@walnut-server/decorators/field'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { SysLangModel } from '../schema/lang.schema'

export class SysLangDTO extends SysLangModel {
  constructor(partial: Partial<SysLangDTO>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysLangDTOSafe extends RealOmitType(SysLangDTO, [] as const) {
  constructor(partial?: Partial<SysLangDTOSafe>) {
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
export class SysLangDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysLangDTOSafe),
) { }

export class SysLangDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysLangDTOSafe),
) { }

// create
export class SysLangDTOCreateRequest extends RealPickType(SysLangDTOSafe, [
  'lang',
  'description',
  'order',
  'status',
] as const) { }
export class SysLangDTOCreateResponse extends SysLangDTOSafe { }

// read
export class SysLangDTOReadResponse extends SysLangDTOSafe { }

// update
export class SysLangDTOUpdateRequest extends RealPickType(SysLangDTOSafe, [
  'lang',
  'description',
  'order',
  'status',
] as const) { }
export class SysLangDTOUpdateResponse extends SysLangDTOSafe { }

// delete
export class SysLangDTODeleteResponse extends SysLangDTOSafe { }
