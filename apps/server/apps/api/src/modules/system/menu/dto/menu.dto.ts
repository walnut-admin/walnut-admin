import { RealOmitType, RealPartialType, RealPickType } from '@walnut-server/utils/dto'

import { Expose, Type } from 'class-transformer'
import { ValidateNested } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { SysMenuModel } from '../schema/menu.schema'

export class SysMenuDTO extends SysMenuModel {
  constructor(partial?: Partial<SysMenuDTO>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysMenuDTOSafe extends RealOmitType(SysMenuDTO, [] as const) {
  constructor(partial?: Partial<SysMenuDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

// menu tree dto
export class SysMenuDTOTree extends RealOmitType(SysMenuDTOSafe, [
  'pid',
  'createdAt',
  'updatedAt',
] as const) {
  constructor(partial: Partial<SysMenuDTOTree>) {
    super()
    Object.assign(this, partial)
  }

  @Expose()
  @Type(() => SysMenuDTOTree)
  @ValidateNested({ each: true })
  children?: SysMenuDTOTree[]
}

class MenuActiveNameItem extends RealPickType(SysMenuDTOTree, ['title', 'name'] as const) {}

export class SysMenuDTOTreeResponse {
  constructor(partial?: Partial<SysMenuDTOTreeResponse>) {
    Object.assign(this, partial)
  }

  @Expose()
  @Type(() => SysMenuDTOTree)
  @ValidateNested({ each: true })
  fullTree: SysMenuDTOTree[]

  @Expose()
  @Type(() => SysMenuDTOTree)
  @ValidateNested({ each: true })
  treeWithoutTypeElement: SysMenuDTOTree[]

  @Expose()
  @Type(() => MenuActiveNameItem)
  @ValidateNested({ each: true })
  menuActiveNamesOptions: { name: string, title: string }[]
}

// list
export class SysMenuDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysMenuDTOSafe),
) {}

export class SysMenuDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysMenuDTOSafe),
) {}

// create
export class SysMenuDTOCreateRequest extends RealPartialType(SysMenuDTOSafe) {}
export class SysMenuDTOCreateResponse extends SysMenuDTOSafe {}

// read
export class SysMenuDTOReadResponse extends SysMenuDTOSafe {}

// update
export class SysMenuDTOUpdateRequest extends RealPartialType(SysMenuDTOSafe) {}
export class SysMenuDTOUpdateResponse extends SysMenuDTOSafe {}

// delete
export class SysMenuDTODeleteResponse extends SysMenuDTOSafe {}
