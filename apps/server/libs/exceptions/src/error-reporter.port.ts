/**
 * 错误上报端口（libs 解耦批 1 的依赖反转）。
 *
 * 全局异常过滤器在 lib 里，而「错误入库」实现在 `libs/app-domain` 的 AppErrorService
 * （Bull 队列 + 掩码 + 白名单）。此前 filter 直接 import app 服务（lib → app 反向依赖，
 * libs 边界 lint 上的存量疤）；现在 filter 只依赖本端口，由该 lib 的 `AppErrorModule` 用
 * `{ provide: WALNUT_ADMIN_ERROR_REPORTER, useExisting: AppErrorService }` 绑定实现。
 */
export const WALNUT_ADMIN_ERROR_REPORTER = Symbol('WALNUT_ADMIN_ERROR_REPORTER')

export interface IWalnutAdminErrorReporter {
  addErrorQueue: (req: IWalnutAdminExpressRequest, resData: IWalnutAdminResponseBase, statusCode: number, error: Error) => Promise<unknown>
}
