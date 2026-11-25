import type { ClassConstructor } from 'class-transformer'
import type { IWalnutAdminConstDecoratorLogOperateAction, IWalnutAdminConstDecoratorLogOperateTitle, IWalnutAdminConstDecoratorLogOperateType } from '@walnut-server/const/decorator/logOperate'

// Note: IWalnutAdminApiOkResponseOptions is global from @walnut-server/decorators/swagger/types.d.ts

declare global {
  interface IWalnutAdminCrudOptions {
    operateLog: IWalnutAdminLogOperateOptions
    swagger: IWalnutAdminApiOkResponseOptions & {
      /**
       * list 端点的**真实响应 DTO**（分页壳类，如 `SysUserDTOListResponse`）。
       * 提供它时 200 响应的 `data` 直接 `$ref` 到该类；缺省 = `CreateWalnutAdminResponseListDTO(DTO)`。
       *
       * 为什么需要：list 行常是 DTO 的字段子集（controller 用 `RealPickType` 裁剪后返回
       * `XxxDTOListResponse`），工厂只拿到 CRUD 的 DTO 时会把行 schema 标成完整 DTO —— 与 wire 漂移。
       */
      listResponseDTO?: ClassConstructor<any>
    }
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
