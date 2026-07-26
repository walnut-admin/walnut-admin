import * as process from 'node:process'
import { registerAs } from '@nestjs/config'

export default registerAs('crypto', () => ({
  /* mfa encryption key, used for encrypting mfa code, do not change easily */
  mfaKey: process.env.MFA_ENCRYPTION_KEY,
  /* refresh token encryption key, used for encrypting refresh token, do not change easily */
  rtKey: process.env.RT_ENCRYPTION_KEY,
  /* device id encryption key, used for encrypting device id, do not change easily */
  deviceIdKey: process.env.DEVICE_ID_ENCRYPTION_KEY,
  /* user identity encryption key, used for encrypting user identity, do not change easily */
  userIdentityKey: process.env.USER_ID_ENCRYPTION_KEY,
  /* user identity hash salt, used for hashing user identity, do not change easily */
  userIdentitySalt: process.env.USER_ID_HASH_SALT,
}))
