import type { ResponseBase } from '@walnut/contract'
import type { AxiosResponse } from 'axios'
import type { IModels } from '@/api/models'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract'
import { removeCurrentPageRequests } from '@walnut/http/adapters/cancel'
import { get, isArray, set } from 'lodash-es'
import { mainoutConst, mainoutLockRoute, mainoutMfaRequiredRoute, mainoutMfaVerifiedRoute } from '@/router/routes/mainout'
import { AppAxios } from '../..'
import { SingletonPromiseCapJSInteraction, SingletonPromiseCapJSRefresh } from './capJSToken'
import { decryptResponseValue } from './crypto'
import { SingletonPromiseRefreshToken } from './refreshToken'
import { SingletonPromiseRsaDecryptFailed } from './rsaDecrypt'
import { SingletonPromiseRsaPubKeyNotFound } from './rsaPubKeyNotFound'
import { SingletonPromiseSign } from './sign'

const userStoreAuth = useAppStoreUserAuth()

export async function responseInterceptors(res: AxiosResponse<ResponseBase<IModels.Base>, any>) {
  // code below is custom code in `axios.response.data`
  const { code, data, msg, meta } = res.data

  // normal success
  if (code === WalnutAdminConstAppResponseCode.SUCCESS) {
    // auto decrypt response data
    const keys = res.config._autoDecryptResponseData as string[]

    if (keys && (Array.isArray(keys) ? keys.length : true)) {
      const keyList = isArray(keys) ? keys : [keys]
      const decryptedData = { ...data }

      for (const key of keyList) {
        const encryptedVal = get(decryptedData, key)
        if (encryptedVal !== null) {
          const decryptedVal = await decryptResponseValue(encryptedVal)
          set(decryptedData, key, decryptedVal)
        }
      }

      return Promise.resolve(decryptedData)
    }
    return Promise.resolve(data)
  }

  // cap js token interaction required
  // manually call cap global modal and verify
  if (code === WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_INTERACTION_REQUIRED) {
    await SingletonPromiseCapJSInteraction()
    return await AppAxios.request(res.config)
  }

  // cap js token refresh required
  // https://capjs.js.org/guide/invisible.html
  if (code === WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_REFRESH_REQUIRED) {
    await SingletonPromiseCapJSRefresh()
    return await AppAxios.request(res.config)
  }

  // when access token is expired, call refresh token api to get new token
  if (code === WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED) {
    await SingletonPromiseRefreshToken(res.config)
    return await AppAxios.request(res.config)
  }

  // when signature is expired, call session key api to get new aes key
  if (code === WalnutAdminConstAppResponseCode.UNAUTHORIZED_EXPIRED_SIGNATURE) {
    await SingletonPromiseSign()
    return await AppAxios.request(res.config)
  }

  // refresh token is expired, so this user need to signout and re-signin
  if (code === WalnutAdminConstAppResponseCode.UNAUTHORIZED_REFRESH_TOKEN_EXPIRED) {
    await userStoreAuth.Signout(false)
    return Promise.reject(new Error('Refresh Token Expired'))
  }

  // rsa decrypt failed
  if (code === WalnutAdminConstAppResponseCode.BAD_REQUEST_DECRYPT_FAILED) {
    // allow to execute encrypt logic in request interceptor again
    res.config._encrypted = false
    await SingletonPromiseRsaDecryptFailed(res)
    return await AppAxios.request(res.config)
  }

  // rsa pub key not found
  if (code === WalnutAdminConstAppResponseCode.BAD_REQUEST_RSA_PUB_KEY_NOT_FOUND) {
    await SingletonPromiseRsaPubKeyNotFound()
    return await AppAxios.request(res.config)
  }

  // not allowed
  const notAllowedErrorCodeMap: Record<number, string> = {
    [WalnutAdminConstAppResponseCode.UNAUTHORIZED_BOT_VERIFY_FAILED]: 'capjsTokenInvalid',
    [WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE]: 'notAllowed',
    [WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_OS_UNSUPPORTED]: 'os',
    [WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_BROWSER_UNSUPPORTED]: 'browser',
    [WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_IP_BLOCKED]: 'ip',
    [WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_USER_AGENT_UNSUPPORTED]: 'userAgent',
    [WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_UNSUPPORTED]: 'device',
    [WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_LOCKED]: 'deviceLocked',
    [WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_BANNED]: 'deviceBanned',
    [WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_RISK_TOO_HIGH]: 'riskTooHigh',
    [WalnutAdminConstAppResponseCode.TOO_MANY_REQUESTS]: 'tooManyRequests',
  }
  if (Object.keys(notAllowedErrorCodeMap).map(Number).includes(code)) {
    await AppRouter.replace({ name: mainoutConst.notAllowed.name, force: true, query: { type: notAllowedErrorCodeMap[code] } })
    removeCurrentPageRequests(AppRouter.currentRoute.value.path)
    return Promise.reject(new Error('Not Allowed'))
  }

  // mfa required
  if (code === WalnutAdminConstAppResponseCode.UNAUTHORIZED_MFA_REQUIRED) {
    const appStoreRoute = useAppStoreRoute()
    appStoreRoute.addDynamicAuthRoute(mainoutMfaRequiredRoute)
    await AppRouter.replace({ name: mainoutConst.mfaRequired.name, force: true })
    return Promise.reject(new Error('MFA Required'))
  }

  // mfa verified
  if (code === WalnutAdminConstAppResponseCode.UNAUTHORIZED_MFA_VERIFY_FAILED) {
    const appStoreRoute = useAppStoreRoute()
    appStoreRoute.addDynamicAuthRoute(mainoutMfaVerifiedRoute)
    await AppRouter.replace({ name: mainoutConst.mfaVerified.name, force: true })
    return Promise.reject(new Error('MFA Verified'))
  }

  // user locked
  if (code === WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCOUNT_LOCKED) {
    const appStoreRoute = useAppStoreRoute()
    appStoreRoute.addDynamicAuthRoute(mainoutLockRoute)
    await AppRouter.replace({ name: mainoutConst.lock.name, force: true })
    return Promise.reject(new Error('User Locked'))
  }

  // sensitive verification required
  if (code === WalnutAdminConstAppResponseCode.UNAUTHORIZED_SENSITIVE_VERIFICATION_REQUIRED) {
    // TODO call up global modal to verify, then retry request after verified
    console.log(123, meta)
    return Promise.reject(new Error('Sensitive Verification Required'))
  }

  useAppMsgError(msg)
  // TODO when to 500
  // await AppRouter.replace({ name: layoutConst.serverError.name, force: true })
  return Promise.reject(new Error('Missing Error Code'))
}
