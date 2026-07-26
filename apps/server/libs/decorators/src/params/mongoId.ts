import { Param } from '@nestjs/common'
import { WalnutAdminConstAppConfig } from '@walnut/const/app/config'
import {
  WalnutAdminPipeMongoId,
  WalnutAdminPipeMongoIds,
} from '@walnut/pipes'

export function WalnutAdminDecoratorParamMongoId(field: string = WalnutAdminConstAppConfig.deleteField) {
  return Param(field, new WalnutAdminPipeMongoId())
}

export function WalnutAdminDecoratorParamMongoIds(field: string = WalnutAdminConstAppConfig.deleteManyField) {
  return Param(field, new WalnutAdminPipeMongoIds())
}
