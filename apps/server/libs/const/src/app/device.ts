/**
 * 设备身份的**唯一形态判据**（B5：device_id 由服务端随机签发，不再由指纹派生）。
 *
 * 为什么落在这里而不是 `libs/system`：判据有三个消费者 —— cookie / param 管道
 * （`libs/pipes`）、`device/initial` 的签发腿（`libs/system`）、migration 的 CHECK
 * （SQL 里必然复制一份正则）。若判据留在 system，`decorators → pipes → system → decorators`
 * 会成环（system 的 DTO 用 decorators 的字段装饰器）；`libs/const` 是最底层、
 * 零依赖的中立常量层，pipes 从这里取判据是单向箭头。
 *
 * 形态：`d1_` + 32 位小写 hex（16 字节随机数）。
 * 前缀是**必须**的：旧形态恰好是 64 位 hex，按长度 / 字符集判别必然混淆；
 * 只有显式前缀能让「旧值」与「伪造值」在**一处**被同一个判据拒掉。
 */

/** 服务端签发的设备 id 形态：d1_ + 32 位小写 hex */
const DEVICE_ID_PATTERN = /^d1_[0-9a-f]{32}$/

/** 前缀常量（cookie 校验 / DTO 校验 / migration CHECK 三处引用，别散写字面量） */
export const WALNUT_DEVICE_ID_PREFIX = 'd1_'

/**
 * 判据：这个值是不是服务端签发的合法设备 id。
 * 旧形态（64 位 hex）、伪造串、空值一律 false —— 调用方应据此走 40605 自愈链路，
 * 而不是「猜一个 id 继续用」。
 */
export function isValidDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value)
}
