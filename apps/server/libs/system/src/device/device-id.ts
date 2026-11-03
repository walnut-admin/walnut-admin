import { randomBytes } from 'node:crypto'

/**
 * 设备身份的服务端签发与校验（B5）。
 *
 * 为什么要有这个模块：改造前 `device_id = HMAC_SHA256(浏览器指纹, DEVICE_ID_ENCRYPTION_KEY)`，
 * 即「客户端自报值的确定性函数」—— 谁拿到别人的指纹，就能铸出别人的设备身份。
 * 现在改成**服务端随机签发**，指纹降级为风控特征（不参与身份派生）。
 *
 * 形态：`d1_` + 32 位小写 hex（16 字节随机数）。
 * 前缀是**必须**的：旧形态恰好是 64 位 hex，按长度 / 字符集判别必然混淆；
 * 只有显式前缀能让「旧值」与「伪造值」在**一处**被同一个判据拒掉。
 */

/** 服务端签发的设备 id 形态：d1_ + 32 位小写 hex */
const DEVICE_ID_PATTERN = /^d1_[0-9a-f]{32}$/

/** 前缀常量（会被 cookie 校验、DTO 校验、migration CHECK 三处引用，别散写字面量） */
export const WALNUT_DEVICE_ID_PREFIX = 'd1_'

/**
 * 签发一个新的设备 id。
 * **只在两处调用**：匿名 `POST /system/device/initial` 与登录成功时（见 device.service）。
 * 其余路径一律不签发 —— 签发点越少，「谁能决定身份」这件事越好审计。
 */
export function generateDeviceId(): string {
  return `${WALNUT_DEVICE_ID_PREFIX}${randomBytes(16).toString('hex')}`
}

/**
 * 判据：这个值是不是服务端签发的合法设备 id。
 * 旧形态（64 位 hex）、伪造串、空值一律 false —— 调用方应据此走 40605 自愈链路，
 * 而不是「猜一个 id 继续用」。
 */
export function isValidDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value)
}
