import { IWalnutAdminConstAppHTTPMethods, WalnutAdminConstAppHTTPMethods } from '@walnut/const/app/methods'
import { IWalnutAdminConstDecoratorLogOperateAction, IWalnutAdminConstDecoratorLogOperateType, WalnutAdminConstDecoratorLogOperateAction, WalnutAdminConstDecoratorLogOperateType } from '@walnut/const/decorator/logOperate'
import { WalnutAdminDecoratorFieldDate, WalnutAdminDecoratorFieldString } from '@walnut/decorators/field'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut/utils/dto'
import { IsOptional } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { SysLogOperateModel } from '../schema/log.operate.schema'

export class SysLogOperateDTO extends SysLogOperateModel {
  constructor(partial: Partial<SysLogOperateDTO>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysLogOperateDTOSafe extends RealOmitType(
  SysLogOperateDTO,
  ['snapshotBefore', 'snapshotAfter'] as const,
) {
  constructor(partial?: Partial<SysLogOperateDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

class SysLogOperateDTOSafeRequest extends RealPartialType(RealOmitType(SysLogOperateDTOSafe, ['actionType', 'operation', 'operatedAt', 'method'] as const)) {
  @WalnutAdminDecoratorFieldString({
    isArray: true,
    swaggerOptions: {
      title: 'actionType for request query, support array',
    },
    validateOptions: {
      onlyIn: [...Object.values(WalnutAdminConstDecoratorLogOperateAction)],
    },
  })
  @IsOptional({ each: true })
  actionType: IWalnutAdminConstDecoratorLogOperateAction

  @WalnutAdminDecoratorFieldString({
    isArray: true,
    swaggerOptions: {
      title: 'operation for request query, support array',
    },
    validateOptions: {
      onlyIn: [...Object.values(WalnutAdminConstDecoratorLogOperateType)],
    },
  })
  @IsOptional({ each: true })
  operation: IWalnutAdminConstDecoratorLogOperateType

  @WalnutAdminDecoratorFieldDate({
    isArray: true,
    swaggerOptions: {
      title: 'operatedAt for request query, support array',
      required: false,
    },
  })
  @IsOptional({ each: true })
  operatedAt: Date

  @WalnutAdminDecoratorFieldString({
    isArray: true,
    swaggerOptions: {
      title: 'http method for request query, support array',
    },
    validateOptions: {
      onlyIn: [...Object.values(WalnutAdminConstAppHTTPMethods)],
    },
  })
  @IsOptional({ each: true })
  method: IWalnutAdminConstAppHTTPMethods
}

// list
export class SysLogOperateDTOListRequest extends CreateWalnutAdminRequestListDTO(SysLogOperateDTOSafeRequest) { }

export class SysLogOperateDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysLogOperateDTOSafe),
) { }

// read
export class SysLogOperateDTOReadResponse extends SysLogOperateDTOSafe { }

// snapshot
export class SysLogOperateDTOSnapshotResponse extends RealPickType(
  SysLogOperateDTO,
  ['snapshotBefore', 'snapshotAfter'] as const,
) {
  constructor(partial?: Partial<SysLogOperateDTOSnapshotResponse>) {
    super()
    Object.assign(this, partial)
  }
}
