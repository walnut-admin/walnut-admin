import type { IWalnutAdminConstDecoratorLogOperateAction, IWalnutAdminConstDecoratorLogOperateTitle, IWalnutAdminConstDecoratorLogOperateType } from '@walnut-server/const/decorator/logOperate'

declare global {
  interface IWalnutAdminLogOperateOptions {
    title: IWalnutAdminConstDecoratorLogOperateTitle
    action?: IWalnutAdminConstDecoratorLogOperateAction
    operateType?: IWalnutAdminConstDecoratorLogOperateType
    needOperateLog?: boolean
  }
}

export {}
