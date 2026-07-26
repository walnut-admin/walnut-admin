import { IWalnutAdminConstDecoratorLogAuthType, WalnutAdminConstDecoratorLogAuthType } from '@walnut-server/const/decorator/logAuth'
import { WalnutAdminDecoratorFieldDate, WalnutAdminDecoratorFieldEnum } from '@walnut-server/decorators/field'
import { RealOmitType, RealPartialType } from '@walnut-server/utils/dto'
import { IsOptional } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { SysLogAuthModel } from '../schema/log.auth.schema'

export class SysLogAuthDTO extends SysLogAuthModel {
  constructor(partial: Partial<SysLogAuthDTO>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysLogAuthDTOSafe extends RealOmitType(
  SysLogAuthDTO,
  [] as const,
) {
  constructor(partial?: Partial<SysLogAuthDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

class SysLogAuthDTOSafeRequest extends RealPartialType(RealOmitType(SysLogAuthDTOSafe, ['type'] as const)) {
  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstDecoratorLogAuthType, {
    isArray: true,
    swaggerOptions: {
      title: 'auth type for request query, support array',
      example: WalnutAdminConstDecoratorLogAuthType.OPAQUE,
    },
  })
  @IsOptional({ each: true })
  type: IWalnutAdminConstDecoratorLogAuthType

  @WalnutAdminDecoratorFieldDate({
    isArray: true,
    swaggerOptions: {
      title: 'authenticatedAt for request query, support array',
      required: false,
    },
  })
  authenticatedAt: Date
}

// list
export class SysLogAuthDTOListRequest extends CreateWalnutAdminRequestListDTO(SysLogAuthDTOSafeRequest) { }

export class SysLogAuthDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysLogAuthDTOSafe),
) { }

// delete
export class SysLogAuthDTODeleteResponse extends SysLogAuthDTOSafe { }
