import type { AxiosRequestConfig } from 'axios'
import type { IStoreApp } from '@/store/types'
import { generateRsaOaepKeyPair } from '@walnut/client/browser/crypto/asymmetric/rsa-oaep'
import { deriveApiSignKey } from '@walnut/client/browser/crypto/derive/api-sign-key'
import { hmacSha256 } from '@walnut/client/browser/crypto/mac/hmac-sha256'
import { enhancedAesGcmLocalStorage } from '@walnut/client/persistent/enhance/index'
import { useAppStorageAsync } from '@walnut/client/persistent/storage/async'
import { generateNonce } from '@walnut/http/utils'
import { SingletonPromise } from '@walnut/utils/queue'
import { buildSignRaw, splitPathAndQuery } from '@walnut/utils/sign-raw'
import { clone, isUndefined, omitBy } from 'lodash-es'
import { defineStore } from 'pinia'
import { getCurrentInstance } from 'vue'
import { rsaPublicKeyAPI } from '@/api/security/rsa'
import { signAesKeyAPI, signInitialAPI } from '@/api/security/sign'
import { AppConstRequestHeaders } from '@/const/app'
import { AppConstPersistKey } from '@/const/persistent'
import { AxiosQsParamsSerializer } from '@/utils/axios/core/config'
import { StoreKeys } from '../../constant'
import { store } from '../../pinia'

// eslint-disable-next-line antfu/no-top-level-await
const clientRsaPubKeyStorage = await useAppStorageAsync(AppConstPersistKey.RSA_PUBLIC_KEY, '', { expire: 30 * 24 * 60 * 60 * 1000, storage: enhancedAesGcmLocalStorage(true) })
// eslint-disable-next-line antfu/no-top-level-await
const clientRsaPrivKeyStorage = await useAppStorageAsync(AppConstPersistKey.RSA_PRIVATE_KEY, '', { expire: 30 * 24 * 60 * 60 * 1000, storage: enhancedAesGcmLocalStorage(true) })
// eslint-disable-next-line antfu/no-top-level-await
const sessionKeyStorage = await useAppStorageAsync(AppConstPersistKey.AUTH_SESSION_KEY, '', { expire: 24 * 60 * 60 * 1000, ttlMode: 'sliding' })

const rsaPubKeyOutDatedQueue = new SingletonPromise<void>()

function SingletonPromiseRsaPubKeyOutDated() {
  return rsaPubKeyOutDatedQueue.run(async () => {
    const appStoreSecurity = useAppStoreSecurity()
    await appStoreSecurity.sendRsaPubKeyToServer(true)
    await appStoreSecurity.getSignAesKey()
  })
}

const useAppStoreSecurityInside = defineStore(StoreKeys.APP_SECURITY, {
  state: (): IStoreApp.Security => ({
    // get from API
    serverRsaPubKey: '',
    // 30 days
    clientRsaPubKey: clientRsaPubKeyStorage,
    // 30 days
    clientRsaPrivKey: clientRsaPrivKeyStorage,
    // in memory
    signAesSecretKey: '',
    // in memory
    signHKDFInfo: '',
    // 1 day sliding
    sessionKey: sessionKeyStorage,
  }),

  getters: {
    getSeverRsaPubKey(state) {
      return state.serverRsaPubKey
    },

    getClientRsaPubKey(state) {
      return state.clientRsaPubKey!
    },

    getClientPrivKey(state) {
      return state.clientRsaPrivKey!
    },

    getSignAesSecretKey(state) {
      return state.signAesSecretKey!
    },

    getSignHKDFInfo(state) {
      return state.signHKDFInfo!
    },

    getSessionKey(state) {
      return state.sessionKey!
    },
  },

  actions: {
    clearServerRsaPubKey() {
      this.serverRsaPubKey = ''
    },

    clearSessionKey() {
      this.sessionKey = ''
    },

    setSessionKey(payload: string) {
      this.sessionKey = payload
    },

    touchSessionKey() {
      const sessionKey = clone(this.getSessionKey)
      this.clearSessionKey()
      this.setSessionKey(sessionKey!)
    },

    async getServerRsaPubKey() {
      if (this.getSeverRsaPubKey) {
        return this.getSeverRsaPubKey
      }
      const resPubKey = await rsaPublicKeyAPI()
      this.serverRsaPubKey = resPubKey
      return resPubKey
    },

    async sendRsaPubKeyToServer(force: boolean) {
      // call handshake API to save rsa pub key in backend redis
      await signInitialAPI(this.getClientRsaPubKey, force)
    },

    async setupSign() {
      if (!this.getClientPrivKey || !this.getClientRsaPubKey) {
        // setup RSA key pair
        const keyPair = await generateRsaOaepKeyPair()
        this.clientRsaPrivKey = keyPair?.privateKey as string
        this.clientRsaPubKey = keyPair?.publicKey as string

        await this.sendRsaPubKeyToServer(false)
      }

      if (!this.getSignAesSecretKey) {
        await this.getSignAesKey()
      }
    },

    async getSignAesKey() {
      const { aesKey, hkdfInfo } = await signAesKeyAPI()
      if (!aesKey) {
        // if logic go here, is mostly like user has a new rsa pair key that does not match ths rsa pub key in backend redis
        // we need to call initial rsa pub key again to update the rsa pub key in backend redis
        await SingletonPromiseRsaPubKeyOutDated()
        return null
      }
      this.signAesSecretKey = aesKey
      this.signHKDFInfo = hkdfInfo
      return aesKey!
    },

    /**
     * 构建签名原文
     *
     * 格式: METHOD|PATH|BODY_PARAMS|timestamp=xxx|nonce=xxx|ua=xxx
     * 与服务端验证侧同一纯函数 `@walnut/utils/sign-raw`（逐字节同源）。
     */
    buildSignRaw(
      config: AxiosRequestConfig,
      timestamp: number,
      nonce: string,
    ) {
      const ua = navigator.userAgent

      // fix request again would cause sign `config.data` error
      const bodyData = typeof config.data === 'string' ? JSON.parse(config.data) : config.data

      // need to manually put the query string params after url（与真正发出的 query 字节一致）
      const cleanParams = omitBy(config.params, isUndefined)
      const paramsStr = Object.keys(cleanParams).length
        ? AxiosQsParamsSerializer(cleanParams)
        : ''

      // config.url 理论上可能自带 query（如 logger 的 ?page=N）：先拆开，
      // 与 params 序列化结果合并，避免「path 含 ? 又拼 query」的双 ? 签名错位
      const { path: rawPath, query: urlQuery } = splitPathAndQuery(config.url!)
      const mergedQuery = [urlQuery, paramsStr].filter(Boolean).join('&')

      return buildSignRaw({
        method: config.method!,
        path: rawPath,
        query: mergedQuery || undefined,
        body: bodyData,
        timestamp,
        nonce,
        ua,
      })
    },

    /**
     * 计算单因子签名（未登录模式）
     *
     * 公式：HMAC-SHA256(raw, aesKey)
     */
    async computeSingleFactorSignature(raw: string, aesKey: string) {
      return await hmacSha256(raw, aesKey)
    },

    /**
     * 计算双因子签名（已登录模式）
     *
     * 公式：HMAC-SHA256(raw, derivedKey)
     * 其中：derivedKey = HKDF(sessionKeyHash, aesKey, info)
     */
    async computeDualFactorSignature(
      raw: string,
      sessionKey: string,
      aesKey: string,
      hkdfInfo: string,
    ) {
      // 1. 派生签名密钥
      const derivedKey = await deriveApiSignKey(sessionKey, aesKey, hkdfInfo)

      // 2. 使用派生密钥计算 HMAC
      return await hmacSha256(raw, derivedKey)
    },

    /**
     * Axios 请求拦截器：自动添加签名
     */
    async axiosReqInterceptorBuildSign(config: AxiosRequestConfig) {
      // 1. 生成时间戳和 Nonce
      const timestamp = Date.now()
      const nonce = generateNonce()
      config.headers![AppConstRequestHeaders.TIMESTAMP] = timestamp
      config.headers![AppConstRequestHeaders.NONCE] = nonce

      // 2. 构建签名原文
      const raw = this.buildSignRaw(config, timestamp, nonce)

      // 3. 获取 AES Key
      const aesKey = this.getSignAesSecretKey

      // 3.1. 如果没有 AES Key，直接返回空字符串
      if (!aesKey) {
        return ''
      }

      // 4. 判断签名模式
      const sessionKey = this.getSessionKey
      let signature: string

      if (sessionKey) {
        // 【已登录】双因子签名
        signature = await this.computeDualFactorSignature(raw, sessionKey, aesKey, this.getSignHKDFInfo)
      }
      else {
        // 【未登录】单因子签名
        signature = await this.computeSingleFactorSignature(raw, aesKey)
      }

      return signature
    },
  },
})

const useAppStoreSecurityOutside = () => useAppStoreSecurityInside(store)

export function useAppStoreSecurity() {
  if (getCurrentInstance())
    return useAppStoreSecurityInside()
  return useAppStoreSecurityOutside()
}
