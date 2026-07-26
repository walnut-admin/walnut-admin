// Note: IWalnutAdminApiOkResponseOptions is now global from @walnut/decorators/swagger/types.d.ts

declare global {
  interface IWalnutAdminCrudOptions {
    operateLog: IWalnutAdminLogOperateOptions
    swagger: IWalnutAdminApiOkResponseOptions
  }
}

export { }
