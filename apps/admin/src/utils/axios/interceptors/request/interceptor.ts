import type { InternalAxiosRequestConfig } from 'axios'
import { cloneDeep, get, isArray, set } from 'lodash-es'
import { AppConstRequestHeaders } from '@/const/app'
import { useAppStoreFingerprint } from '@/store/modules/app/app-fingerprint'
import { useAppStoreLocale } from '@/store/modules/app/app-locale'
import { useAppStoreSecurity } from '@/store/modules/app/app-security'
import { useAppStoreUserAuth } from '@/store/modules/user/user-auth'
import { setTokenHeaderWithConfig } from '../../utils'
import { encryptRequestValue } from './crypto'

const userStoreAuth = useAppStoreUserAuth()
const appStoreLocale = useAppStoreLocale()
const appStoreSecurity = useAppStoreSecurity()
const appStoreFingerprint = useAppStoreFingerprint()

export async function requestInterceptors(config: InternalAxiosRequestConfig) {
  // custom headers
  config.headers[AppConstRequestHeaders.LANGUAGE] = appStoreLocale.getLocale

  // fingerprint
  config.headers[AppConstRequestHeaders.FINGERPRINT] = appStoreFingerprint.axiosReqInterceptorBuildFingerprint(config)

  // request data encrypt（**必须在 sign 之前**，Q10 / L1 修复）
  //
  // 服务端 sign.guard 签的是 `req.body` 的**网络形态**（拦截器不在 guard 链上、解密发生在
  // guard 之后），所以客户端的签名原文也必须是发出去的密文。旧顺序是「先签名、后加密」
  // —— 签名算的是明文、发的是密文，服务端恒 40112（静默错位）。这里把加密段提到签名之前，
  // 两侧的「签名原文」重新对齐到同一份字节。
  //
  // 语义记录（不许再退回）：`_autoEncryptRequestData` 启用后，
  // - 签名覆盖**密文**（不是明文）；
  // - `_plainData` 只用于 40011 自愈重放（`response/rsaDecrypt.ts` 把原明文塞回
  //   `config.data`、清掉服务端公钥缓存，下一次拦截器重新加密 + 重新签名）；
  // - 40011 的重放会得到新的 timestamp / nonce（每次请求现算，不复用非派生的旧值）。
  if (config._autoEncryptRequestData && !config._encrypted) {
    // tag this request to avoid encrypt again
    config._encrypted = true

    // we only handle request body data
    if (config.data) {
      // put original post data in _plainData
      config._plainData = cloneDeep(config.data)

      const keys = config._autoEncryptRequestData

      if (keys && (Array.isArray(keys) ? keys.length : true)) {
        const keyList = isArray(keys) ? keys : [keys]

        for (const key of keyList) {
          const plain = get(config.data, key)
          // 缺键 / null / 空串都不加密：锁屏偏好在 default 模式下可以不带新密码，
          // 旧条件只挡 null，undefined 会被 encryptRequestValue 变成「空串信封」，
          // 服务端解出 '' 后撞 DTO 的 minLen（40099）。
          if (plain !== null && plain !== undefined && plain !== '') {
            const cipher = await encryptRequestValue(plain)
            set(config.data, key, cipher)
          }
        }
      }
    }
  }

  // sign（签到的就是上面**已经加密完成**的 config.data）
  config.headers[AppConstRequestHeaders.SIGN] = await appStoreSecurity.axiosReqInterceptorBuildSign(config)

  // carry token
  if (userStoreAuth.getAccessToken)
    setTokenHeaderWithConfig(config, userStoreAuth.getAccessToken)

  // add timestamp
  if (config._timestamp) {
    if (config.params) {
      config.params = Object.assign(config.params, { t: Date.now() })
    }
    else {
      config.params = {
        t: Date.now(),
      }
    }
  }

  return config
}
