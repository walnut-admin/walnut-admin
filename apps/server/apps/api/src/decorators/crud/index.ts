import type { IWalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import type { ClassConstructor } from 'class-transformer'
import { WalnutAdminConstDecoratorLogOperateAction } from '@walnut-server/const/decorator/logOperate'

import { WalnutAdminDecoratorCreate } from './create'
import { WalnutAdminDecoratorDelete } from './delete'
import { WalnutAdminDecoratorDeleteMany } from './deleteMany'
import { WalnutAdminDecoratorList } from './list'
import { WalnutAdminDecoratorRead } from './read'
import { WalnutAdminDecoratorUpdate } from './update'

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
