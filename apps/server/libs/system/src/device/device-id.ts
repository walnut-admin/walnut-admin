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
 * **只在两处调用**：匿名 `POST /system/device/initial` 与登录成功时（见 device.service）。
 * 其余路径一律不签发 —— 签发点越少，「谁能决定身份」这件事越好审计。
 */
export function generateDeviceId(): string {
  return `${WALNUT_DEVICE_ID_PREFIX}${randomBytes(16).toString('hex')}`
}
