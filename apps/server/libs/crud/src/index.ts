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
  type IWalnutAdminIpLocationResolver,
  type IWalnutAdminOperateLogRecord,
  type IWalnutAdminOperateLogWriter,
  WALNUT_ADMIN_IP_LOCATION_RESOLVER,
  WALNUT_ADMIN_OPERATE_LOG_WRITER,
} from './operate-log/operate-log.ports'
export { WalnutAdminDecoratorRead } from './read'
export { WalnutAdminDecoratorUpdate } from './update'

interface WalnutAdminCrudDecoratorsOptions {
  title: IWalnutAdminConstDecoratorLogOperateTitle
  DTO: ClassConstructor<any>
  extra?: {
    needOperateLog?: boolean
  }
}

export function WalnutCrudDecorators(options: WalnutAdminCrudDecoratorsOptions) {
  const { title, DTO, extra = {} } = options

  const { needOperateLog = true } = extra

  return {
    WalnutAdminDecoratorList: () =>
      WalnutAdminDecoratorList({
        operateLog: { title, needOperateLog },
        swagger: { DTO },
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
