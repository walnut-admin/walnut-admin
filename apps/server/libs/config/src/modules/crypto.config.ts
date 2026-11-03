import * as process from 'node:process'
import { registerAs } from '@nestjs/config'

export default registerAs('crypto', () => ({
  /* mfa encryption key, used for encrypting mfa code, do not change easily */
  mfaKey: process.env.MFA_ENCRYPTION_KEY,
  /* refresh token encryption key, used for encrypting refresh token, do not change easily */
  rtKey: process.env.RT_ENCRYPTION_KEY,
  /* 历史：指纹 -> deviceId 的 HMAC 盐（B5 起 device_id 由服务端随机签发）。**0 个消费者**
     —— 没有任何加解密 / 派生 / 身份用途。下一行只是**注册**；另两处读者是 validation.ts 的
     **必填校验**与 process.d.ts 的**类型声明** —— 三处都是配置骨架，不是使用。
     保留理由：这个 env 是「部署后不许改的 5 个」之一（apps/server/AGENTS.md），
     摘属性与摘 env 必须同一批做（见 reports/batch-14/r1-residuals.md 14-D）。 */
  deviceIdKey: process.env.DEVICE_ID_ENCRYPTION_KEY,
  /* user identity encryption key, used for encrypting user identity, do not change easily */
  userIdentityKey: process.env.USER_ID_ENCRYPTION_KEY,
  /* user identity hash salt, used for hashing user identity, do not change easily */
  userIdentitySalt: process.env.USER_ID_HASH_SALT,
}))
