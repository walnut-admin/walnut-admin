import type { IRequestPayload } from '../request'
import { SecurityRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

/**
 * @description 完成敏感操作二次验证（POST /security/sensitive/verify）
 *
 * 成功后服务端把授权写进 Redis（`sensitive_op:<userId>:<deviceId>:<level>`，15 分钟），
 * **没有返回凭证** —— 放行原操作靠「同一设备 + 同一 level 重新打一次」，这正是 40119 接线的
 * 重放语义（见 `utils/axios/interceptors/response/sensitiveVerify.ts`）。
 *
 * `level` / `operationType` 必须取自 40119 响应的 `meta`（服务端守卫装饰器元数据），
 * 不要在前端写死：`operationType` 缺省会被 controller 直接拦成 40099。
 *
 * `method` 是**服务端口径**（password / sms / mfa / email，真源
 * `apps/server/libs/security/src/sensitive/sensitive.const.ts` 的 `WalnutAdminConstVerifyMethod`），
 * 与组件那套 sms / email / totp / webauthn 不是同一套词表，映射只在 40119 接线处做一次。
 */
export function verifySensitiveAPI(data: IRequestPayload.Security.Sensitive.Verify) {
  return AppAxios.post<boolean>({
    url: `${SecurityRoutes.SENSITIVE}/verify`,
    data: {
      level: data.level,
      operationType: data.operationType,
      method: data.method,
      credential: data.credential,
    },
  })
}
