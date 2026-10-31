import type { IWalnutAdminConstDecoratorLogOperateAction, IWalnutAdminConstDecoratorLogOperateTitle, IWalnutAdminConstDecoratorLogOperateType } from '@walnut-server/const/decorator/logOperate'

// Note: IWalnutAdminApiOkResponseOptions is global from @walnut-server/decorators/swagger/types.d.ts

declare global {
  interface IWalnutAdminCrudOptions {
    operateLog: IWalnutAdminLogOperateOptions
    swagger: IWalnutAdminApiOkResponseOptions
  }

  // 批 4：随 operate-log 装饰器从 app（原 apps/api/src/decorators/walnut/types.d.ts）
  // 迁入 lib —— crud 装饰器工厂与操作日志装饰器的公共入参形状
  interface IWalnutAdminLogOperateOptions {
    title: IWalnutAdminConstDecoratorLogOperateTitle
    action?: IWalnutAdminConstDecoratorLogOperateAction
    operateType?: IWalnutAdminConstDecoratorLogOperateType
    needOperateLog?: boolean
  }
}

export { }
