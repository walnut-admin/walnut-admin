// Crypto 类型
export type {
  AesGcmRawInput,
  AesGcmRawResult,
  CryptoResult,
  PEMKeyType,
  RsaKeyPairPEM,
} from './crypto/const'

export { AES_GCM, PEM, RSA_OAEP } from './crypto/const'

// Crypto 转换器
export {
  arrayBufferToBase64,
  arrayBufferToHex,
  base64ToArrayBuffer,
  base64ToUint8Array,
  hexToUint8Array,
  uint8ArrayToBase64,
  uint8ArrayToHex,
  uint8ArrayToUtf8,
  utf8ToUint8Array,
} from './crypto/transformer'
// 嵌套对象 ↔ 扁平 path
export { objectToPaths, pathsToObject } from './object-paths'

export type { ObjectToPathsOptions, PathRecord } from './object-paths'

// Persistent storage enhancement
export { withAsyncConditionalEncryption } from './persistent/enhance/async'
export { withSyncConditionalEncryption } from './persistent/enhance/sync'
// 工具类
export { SingletonPromise } from './queue'
// Regex
export { isEmailAddress, isPhoneNumber } from './regex'
// 签名原文构造（双端逐字节同源）
export { buildSignRaw, splitPathAndQuery, stripApiPrefix } from './sign-raw'
export type { SignRawParts } from './sign-raw'
