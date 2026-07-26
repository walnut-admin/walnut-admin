import { WalnutDBModelName, WalnutDBVirtualName } from '@walnut/db'
import { WalnutAdminDecoratorFieldObject } from '@walnut/decorators/field/object.decorator'
import { Schema } from 'mongoose'
import { SysUserDTOSafe } from '@/modules/system/user/dto/user.dto'
import { ISysUserDocument } from '@/modules/system/user/schema/user.schema'
import { addVirtual } from '../virtual'

export function addVirtualUserThroughUserId(schema: Schema, localeField: string = 'userId') {
  return addVirtual(schema, {
    virtualPath: WalnutDBVirtualName.USER,
    ref: WalnutDBModelName.SYS_USER,
    localField: localeField,
    foreignField: '_id',
    justOne: true,
  })
}

export interface IVirtualUser {
  populated_user?: ISysUserDocument | null
}

export class WalnutAdminVirtualUserDTO {
  constructor(partial: Partial<WalnutAdminVirtualUserDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldObject(SysUserDTOSafe, {
    swaggerOptions: {
      title: 'virtual user',
    },
  })
  populated_user?: ISysUserDocument | null
}
