import { randomBytes } from 'node:crypto'
import { WALNUT_DEVICE_ID_PREFIX } from '@walnut-server/const/app/device'

/**
 * 设备身份的签发（B5）。
 *
 * 形态判据 `isValidDeviceId` / 前缀常量在 `@walnut-server/const/app/device` —— 那是
 * “一处判据”的中立落点（pipes 也要用，而 pipes 不能反过来依赖 libs/system）。本文件
 * 只留**签发**与再导出，保持 `@walnut-server/system` 的既有 import 面不变。
 *
 * 为什么不再由指纹派生：改造前 `device_id = HMAC_SHA256(浏览器指纹, DEVICE_ID_ENCRYPTION_KEY)`，
 * 即「客户端自报值的确定性函数」—— 谁拿到别人的指纹，就能铸出别人的设备身份。
 * 现在改成**服务端随机签发**，指纹降级为风控特征（不参与身份派生）。
 */

export { isValidDeviceId, WALNUT_DEVICE_ID_PREFIX } from '@walnut-server/const/app/device'

/**
 * 签发一个新的设备 id。
 *
 * 生产调用点**只有 1 处**：`device.service.ts` 的 initial（匿名 `POST /system/device/initial`）。
 * 登录**不**签发 —— 登录复用 cookie 里那枚已签发的 id（initial 里
 * `isValidDeviceId(cookieDeviceId) ? cookieDeviceId : generateDeviceId()`）。
 * 其余命中全是单测 / 集成夹具（`device-id.spec.ts`、`device.*.pg.int-spec.ts`），不是签发路径。
 *
 * 为什么只有一处更安全：签发点越少，「谁能决定一个设备身份」这个面就越小 —— 一处就等于
 * 「请求带不带合法 cookie」，没有第二条腿要单独审计。B5 之前恰好相反：身份是客户端自报
 * 指纹的确定性函数，签发权实际在客户端（知道指纹就能铸出同一身份）。
 *
 * 「1 处」这件事由 `device-issuance.drift.spec.ts` 机械守（数调用点，不靠这段注释自觉）。
 */
export function generateDeviceId(): string {
  return `${WALNUT_DEVICE_ID_PREFIX}${randomBytes(16).toString('hex')}`
}
