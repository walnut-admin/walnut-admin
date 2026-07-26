import type { IWalnutAdminConstDecoratorLogOperateAction, IWalnutAdminConstDecoratorLogOperateTitle, IWalnutAdminConstDecoratorLogOperateType } from '@walnut/const/decorator/logOperate'

declare global {
  interface IWalnutAdminLogOperateOptions {
    title: IWalnutAdminConstDecoratorLogOperateTitle
    action?: IWalnutAdminConstDecoratorLogOperateAction
    operateType?: IWalnutAdminConstDecoratorLogOperateType
    needOperateLog?: boolean
  }
}

export {}
