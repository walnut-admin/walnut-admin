import type { IWalnutAdminConstAppHTTPMethods } from '@walnut-server/const/app/methods'
import type { IWalnutAdminConstDecoratorLogOperateAction, IWalnutAdminConstDecoratorLogOperateType } from '@walnut-server/const/decorator/logOperate'
import type { Recordable } from 'easy-fns-ts'

/**
 * 操作日志拦截器的依赖端口（libs 解耦批 4）。
 *
 * 拦截器随 crud 装饰器抽入 libs 后，原先直接注入的服务不能跨向引用，
 * 改为端口 + `useExisting` 绑定（批 1/2 的 AppErrorService / WALNUT_ADMIN_TOKEN_TTL 同款手法）：
 * - `WALNUT_ADMIN_OPERATE_LOG_WRITER` ← `libs/system` 的 SysLogOperateRepoService（create）
 *
 * IP 定位端口 `WALNUT_ADMIN_IP_LOCATION_RESOLVER` 已迁到实现所在的 `libs/ip`
 * （`ip.ports.ts`，F-14 / Decision 3「token 放需要它的 lib」）：crud → ip 是
 * assemble → base 的合法方向，ip 不再反引本 lib（原落点即 ARCH-01 的「设施依赖内核」边）。
 *
 * 绑定跟随实现所在层：`SysLogOperateRepoModule`（libs/system）@Global + useExisting。
 * 实现侧以 `implements` 做编译期守护（任一方法改名/改签名立刻红，
 * 而不是等运行期 token 解析出 undefined）。
 */

export const WALNUT_ADMIN_OPERATE_LOG_WRITER = Symbol('WALNUT_ADMIN_OPERATE_LOG_WRITER')

/**
 * 写入一条操作日志的形状 —— 与 app 侧 `SysLogOperateDTO` 的必需字段逐项同型
 * （由 SysLogOperateRepoService.create 的入参收窄而来，wire 形态零变化）
 */
export interface IWalnutAdminOperateLogRecord {
  title: string
  actionType: IWalnutAdminConstDecoratorLogOperateAction
  operation: IWalnutAdminConstDecoratorLogOperateType
  method: IWalnutAdminConstAppHTTPMethods
  url: string
  httpVersion: string
  statusCode: number
  requestData: Recordable | null
  rawRequestData: string | null
  responseData: Recordable | null
  rawResponseData: string | null
  durationMs: number
  os: string
  browser: string
  ip: string
  location: string
  deviceId: string
  userId: string | null
  userName: string
  invokingMethod: string
  success: boolean
  snapshotBefore: Recordable
  snapshotAfter: Recordable
}

export interface IWalnutAdminOperateLogWriter {
  create: (record: IWalnutAdminOperateLogRecord) => Promise<{ id: string }>
}
