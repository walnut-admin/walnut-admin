/// <reference types="./types" />

import type { IWalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import type { ClassConstructor } from 'class-transformer'
import { WalnutAdminConstDecoratorLogOperateAction } from '@walnut-server/const/decorator/logOperate'

import { WalnutAdminDecoratorCreate } from './create'
import { WalnutAdminDecoratorDelete } from './delete'
import { WalnutAdminDecoratorDeleteMany } from './deleteMany'
import { WalnutAdminDecoratorList } from './list'
import { WalnutAdminDecoratorRead } from './read'
import { WalnutAdminDecoratorUpdate } from './update'

export { WalnutAdminDecoratorCreate } from './create'
export { WalnutAdminDecoratorDelete } from './delete'
export { WalnutAdminDecoratorDeleteMany } from './deleteMany'
export { WalnutAdminDecoratorList } from './list'
export { WalnutAdminDecoratorOperateLog, WalnutAdminInterceptorRequestOperateLog } from './operate-log/operate-log.decorator'
export {
  type IWalnutAdminOperateLogRecord,
  type IWalnutAdminOperateLogWriter,
  WALNUT_ADMIN_OPERATE_LOG_WRITER,
} from './operate-log/operate-log.ports'
export { WalnutAdminDecoratorRead } from './read'
export { WalnutAdminDecoratorUpdate } from './update'

interface WalnutAdminCrudDecoratorsOptions {
  title: IWalnutAdminConstDecoratorLogOperateTitle
  DTO: ClassConstructor<any>
  /**
   * list 端点实际返回的分页壳 DTO（行可能是 DTO 的字段子集）。
   * 缺省时 list 的行 schema 退回完整 `DTO`；见 `WalnutAdminDecoratorList` 的说明。
   */
  listResponseDTO?: ClassConstructor<any>
  extra?: {
    needOperateLog?: boolean
  }
}

export function WalnutCrudDecorators(options: WalnutAdminCrudDecoratorsOptions) {
  const { title, DTO, listResponseDTO, extra = {} } = options

  const { needOperateLog = true } = extra

  return {
    WalnutAdminDecoratorList: () =>
      WalnutAdminDecoratorList({
        operateLog: { title, needOperateLog },
        swagger: { DTO, listResponseDTO },
      }),

    WalnutAdminDecoratorCreate: () =>
      WalnutAdminDecoratorCreate({
        operateLog: {
          title,
          action: WalnutAdminConstDecoratorLogOperateAction.CREATE,
          needOperateLog,
        },
        swagger: { DTO },
      }),

    WalnutAdminDecoratorRead: (field?: string) =>
      WalnutAdminDecoratorRead(
        {
          operateLog: { title, needOperateLog },
          swagger: { DTO },
        },
        field,
      ),

    WalnutAdminDecoratorUpdate: () =>
      WalnutAdminDecoratorUpdate({
        operateLog: {
          title,
          action: WalnutAdminConstDecoratorLogOperateAction.UPDATE,
          needOperateLog,
        },
        swagger: { DTO },
      }),

    WalnutAdminDecoratorDelete: (field?: string) =>
      WalnutAdminDecoratorDelete(
        {
          operateLog: {
            title,
            action: WalnutAdminConstDecoratorLogOperateAction.DELETE,
            needOperateLog,
          },
          swagger: { DTO },
        },
        field,
      ),

    WalnutAdminDecoratorDeleteMany: (field?: string) =>
      WalnutAdminDecoratorDeleteMany(
        {
          operateLog: {
            title,
            action: WalnutAdminConstDecoratorLogOperateAction.DELETE_MANY,
            needOperateLog,
          },
          swagger: { DTO },
        },
        field,
      ),
  }
}
