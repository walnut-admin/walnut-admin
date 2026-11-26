import type { VerifyAuthMethodType } from '@/components/Global/VerifyAuth/types'
import { SingletonPromise } from '@walnut/client/queue'
import { useStoreCompVerifyAuth } from '@/store/modules/component/comp-verify-auth'

/**
 * 40119（敏感操作需要二次验证）→ 全局 VerifyAuth 弹窗 → 重放原请求的接线。
 *
 * ### 服务端契约（写这段代码前已对照 `sensitive.guard.ts` / `sensitive.controller.ts`）
 *
 * 1. 守卫挂在受保护端点上（`DELETE /system/user/identity/unbind/:type/:purpose` 等），
 *    本设备在 `sensitive_op:<userId>:<deviceId>:<level>` 没有授权时抛 40119；
 * 2. 40119 的 `meta` 是**挑战描述符**：`needsVerification` / `availableMethods` /
 *    `preferredMethod`，外加 `level` 与 `operationType`（2026-11-26 补：verify 端点两个都必填，
 *    客户端推导不出来）；
 * 3. 完成验证 = `POST /security/sensitive/verify { level, operationType, method, credential }`，
 *    服务端把授权写进 Redis（15 分钟，按 **userId + deviceId + level**）；
 * 4. **放行原操作没有 ticket / 一次性凭证机制** —— 授权是设备级的，重打一次原请求即可。
 *    所以这里的「重放」就是 VerifyAuth 成功后 `AppAxios.request(config)`，与 40101/40117/40605
 *    的自愈重放同一形态。
 *
 * ### 单例语义
 *
 * 并发多个 40119 只弹一次窗：`SingletonPromise` 把窗口期内的调用并到同一个 promise 上，
 * 全部拿到同一个「验证通过没通过」的布尔值再各自重放。窗口外（弹窗已关）再来的 40119
 * 是新一轮（每个请求的 `_sensitiveVerifyRetried` 保证它最多弹一次窗）。
 *
 * 已知边界（记录，不处理）：窗口内两个 40119 若属于**不同 level**，共享的弹窗只给第一个
 * 的 level 授权，另一个重放后仍 40119 → 落到统一错误提示。当前受保护端点全是
 * `account_critical`，不构成实际问题。
 */
const sensitiveVerifyQueue = new SingletonPromise<boolean>()

export interface SensitiveChallengeDescriptor {
  level: string
  operationType: string
  /** 组件词表里的可用方式（服务端 method 词表已映射） */
  allowedMethods: VerifyAuthMethodType[]
}

/**
 * 服务端 `WalnutAdminConstVerifyMethod` → 组件方法词表。
 *
 * - `sms` / `email` 同名直通；
 * - `mfa` 在组件里是 `totp`（server 侧 TOTP 走 mfa 分支）；
 * - `password` 不进组件：服务端 P1-5 已把它从可用列表摘除（identity 的 value 是 opaque
 *   record，无法明文比对），组件也没有口令步骤。
 */
function toComponentMethods(methods: unknown): VerifyAuthMethodType[] {
  if (!Array.isArray(methods)) {
    return []
  }

  const mapped: VerifyAuthMethodType[] = []

  for (const method of methods) {
    if (method === 'sms' || method === 'email') {
      mapped.push(method)
    }
    else if (method === 'mfa') {
      mapped.push('totp')
    }
  }

  return mapped
}

/** 从 40119 的 `meta` 解析挑战描述符；缺关键键返回 null（老服务端 / 契约漂移） */
export function parseSensitiveChallenge(meta: unknown): SensitiveChallengeDescriptor | null {
  if (typeof meta !== 'object' || meta === null) {
    return null
  }

  const challenge = meta as Record<string, unknown>
  const { level, operationType } = challenge

  if (typeof level !== 'string' || level === '' || typeof operationType !== 'string' || operationType === '') {
    return null
  }

  return {
    level,
    operationType,
    allowedMethods: toComponentMethods(challenge.availableMethods),
  }
}

/**
 * 打开全局二次验证弹窗并等结果（true = 已通过，可以重放原请求）。
 *
 * 描述符不可用时返回 false 且不弹窗 —— 拦截器会落到统一错误提示，而不是让用户在一个
 * 无法完成的弹窗里空转。
 */
export function SingletonPromiseSensitiveVerify(meta: unknown): Promise<boolean> {
  const compStoreVerifyAuth = useStoreCompVerifyAuth()

  return sensitiveVerifyQueue.run(async () => {
    const descriptor = parseSensitiveChallenge(meta)

    if (descriptor === null || descriptor.allowedMethods.length === 0) {
      console.warn('[sensitive] 40119 的 meta 缺 level/operationType/可用验证方式，无法发起二次验证', meta)
      return false
    }

    const result = await compStoreVerifyAuth.onOpenVerifyAuthModal({
      mode: 'verify',
      // 敏感验证的可用方式由**安全身份**（purpose=security）供给，服务端 `getUserAvailableMethods`
      // 也只看 security 身份 —— 这里的 purpose 必须是 security，否则发码会打到登录身份上。
      purpose: 'security',
      allowedMethods: descriptor.allowedMethods,
      sensitive: {
        level: descriptor.level,
        operationType: descriptor.operationType,
      },
    })

    return result.verified
  })
}
