import type { ValueOf } from 'easy-fns-ts'

/**
 * AES-GCM wire format constants.
 * These values MUST be identical between frontend (Web Crypto) and backend (Node crypto)
 * for encryption/decryption interoperability.
 *
 * 本模块另寄放 `AppKeyTypeConst`：它是**应用密钥类型清单**（RSA_PAIR / AES_KEY_URL /
 * JWT_AT / JWT_RT），不是 wire format —— 因 server 落库与 admin 请求两侧同源消费，
 * 留在 contract 的 crypto-wire 入口，不要当作加密参数解读。
 */
export const AES_GCM_WIRE = {
  /** AES-256 key length in bytes (the key blob RSA-encrypts is key|iv|tag) */
  KEY_LENGTH: 32,
  /** Initialization Vector length in bytes (96-bit IV recommended for GCM) */
  IV_LENGTH: 12,
  /** Authentication tag length in bytes (128-bit tag for GCM) */
  TAG_LENGTH: 16,
  /** Minimum encrypted payload length in bytes (IV + TAG, no ciphertext) */
  MIN_PAYLOAD_LENGTH: 28, // IV_LENGTH(12) + TAG_LENGTH(16)
} as const

/** App key type wire values — the key kind stored in app_key / requested by clients */
export const AppKeyTypeConst = {
  RSA_PAIR: 'RSA_PAIR',
  AES_KEY_URL: 'AES_KEY_URL',
  JWT_AT: 'JWT_AT',
  JWT_RT: 'JWT_RT',
} as const

export type AppKeyTypeConstType = ValueOf<typeof AppKeyTypeConst>
