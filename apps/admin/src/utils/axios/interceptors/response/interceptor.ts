import type { ResponseBase } from '@walnut/contract'
import type { AxiosResponse } from 'axios'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract'
import { removeCurrentPageRequests } from '@walnut/http/adapters/cancel'
import { get, isArray, set } from 'lodash-es'
import { useAppMsgError } from '@/hooks/component/useMessage'
import { AppRouter } from '@/router/index'
import { mainoutConst, mainoutLockRoute, mainoutMfaRequiredRoute, mainoutMfaVerifiedRoute } from '@/router/routes/mainout'
import { useAppStoreRoute } from '@/store/modules/app/app-route'
import { useAppStoreUserAuth } from '@/store/modules/user/user-auth'
import { AppAxios } from '../..'
import { SingletonPromiseCapJSInteraction, SingletonPromiseCapJSRefresh } from './capJSToken'
import { decryptResponseValue } from './crypto'
import { SingletonPromiseDeviceReset } from './device'
import { SingletonPromiseRefreshToken } from './refreshToken'
import { SingletonPromiseRsaDecryptFailed } from './rsaDecrypt'
import { SingletonPromiseRsaPubKeyNotFound } from './rsaPubKeyNotFound'
import { SingletonPromiseSign } from './sign'

const userStoreAuth = useAppStoreUserAuth()

export async function responseInterceptors(res: AxiosResponse<ResponseBase<{ id: string }>, any>) {
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
  //
  // P1（review CAP-5）：`comp-capjs.ts:56-59` 的 `refreshCapJSToken` 失败时 **return ''**（不抛），
  // 旧实现无条件重放原请求 ⇒ 40117 → 空 token → 重放 → 40117 … 无限打转，直到 CAP 自己的
  // 4 次/60 秒限流返回 42900 把用户直接踢到 /not-allowed 页。
  // 照 40101（refreshToken.ts）与 40605（下面的 `_deviceResetRetried`）的写法：
  // **每个请求最多自愈一次**，且**只有真拿到新 token 才重放**。
  if (code === WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_REFRESH_REQUIRED && !res.config._capRefreshRetried) {
    res.config._capRefreshRetried = true

    const capToken = await SingletonPromiseCapJSRefresh()

    if (capToken) {
      return await AppAxios.request(res.config)
    }

    // 空串 = 无感刷新失败（WASM 被 CSP 拦 / cap.js 服务不可用 / 用户环境不支持）。
    // 不重放（重放必然再 40117），也不跳 /not-allowed（那不是用户做错了什么）——
    // 落到函数末尾的兜底：提示 + reject，由调用方决定重试。
    console.warn('[cap] silent refresh failed, original request is not replayed')
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

  // P0-1：设备 cookie 过期 / 被清 / 行没了 —— 40605 是**可自愈**的，不是永久拒绝。
  // 学 40101 的写法：清本地 device 缓存 → 重走 /system/device/initial → 重放原请求；
  // `_deviceResetRetried` 保证每个请求只自愈一次（自愈后仍 40605 就落到下面的
  // notAllowed 分支，不会打转）。自愈本身失败（initial 也被拒 / 网络）同样落到下面。
  if (code === WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_UNSUPPORTED && !res.config._deviceResetRetried) {
    res.config._deviceResetRetried = true

    let healed = false

    try {
      await SingletonPromiseDeviceReset()
      healed = true
    }
    catch (e) {
      console.warn('[device] reset failed, falling back to not-allowed page', e)
    }

    if (healed) {
      return await AppAxios.request(res.config)
    }
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
    // 40608 Bot Detected：SecurityGuard 对可疑 UA/头在敏感路径上直接拒。
    // 之前漏了这一条 ⇒ 落到函数末尾的兜底分支 ⇒ 启动期抛出的 Error 文案是
    // 「Missing Error Code」，把真实原因（被判定为机器人）整条盖住。
    // 用通用 notAllowed 作为 reason（详细文案走 sys_locale，新增 key 要动 seed，另批做）。
    [WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_BOT_DETECTED]: 'notAllowed',
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
  // 兜底错误必须**带码**：启动期（naive-ui provider 未挂载）toast 会降级成 console，
  // 此时用户看到的只有这个 Error 的 message；旧实现写死「Missing Error Code」，
  // 等于把所有未登记的码变成同一个无法定位的字符串。
  return Promise.reject(new Error(`[${code}] ${msg || 'Unknown error'}`))
}
