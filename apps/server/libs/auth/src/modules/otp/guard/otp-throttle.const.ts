/**
 * P1-16（2026-10-28）：OTP 动态限流配置服务的元数据键。
 *
 * 单独成文件避免 decorator ↔ guard 的循环 import：装饰器写键、守卫读键必须用同一个值
 * （旧实现装饰器写 Symbol、守卫读字符串 'OTP_THROTTLE_SERVICE'，getAllAndOverride 恒
 * undefined，sendLimit/sendTtl 从未生效）。
 */
export const OTP_THROTTLE_SERVICE_KEY = Symbol('OTP_THROTTLE_SERVICE_KEY')
