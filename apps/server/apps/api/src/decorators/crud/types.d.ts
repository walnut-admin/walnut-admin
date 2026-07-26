// Note: IWalnutAdminApiOkResponseOptions is now global from @walnut-server/decorators/swagger/types.d.ts

declare global {
  interface IWalnutAdminCrudOptions {
    operateLog: IWalnutAdminLogOperateOptions
    swagger: IWalnutAdminApiOkResponseOptions
  }
}

export { }
