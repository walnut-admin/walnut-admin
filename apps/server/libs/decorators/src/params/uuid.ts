import { Param } from '@nestjs/common'
import { WalnutAdminConstAppConfig } from '@walnut-server/const/app/config'
import {
  WalnutAdminPipeUuid,
  WalnutAdminPipeUuids,
} from '@walnut-server/pipes'

/**
 * PostgreSQL `uuid` 主键的路由参数装饰器（对应 Mongo 版
 * `WalnutAdminDecoratorParamMongoId(s)`，命名与取参字段约定保持一致）。
 */
export function WalnutAdminDecoratorParamUuid(field: string = WalnutAdminConstAppConfig.deleteField) {
  return Param(field, new WalnutAdminPipeUuid())
}

export function WalnutAdminDecoratorParamUuids(field: string = WalnutAdminConstAppConfig.deleteManyField) {
  return Param(field, new WalnutAdminPipeUuids())
}
