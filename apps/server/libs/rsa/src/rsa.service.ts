import type { IWalnutAdminKeyStore } from './rsa.ports'
import { Buffer } from 'node:buffer'
import { constants, createCipheriv, createDecipheriv, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto'

import { Inject, Injectable } from '@nestjs/common'
import { AppTechCacheRsaService } from '@walnut-server/cache'
import { WalnutAdminExceptionRsaDecryptFailed } from '@walnut-server/exceptions/business/rsa'
import { AES_GCM_WIRE, AppKeyTypeConst } from '@walnut/contract/crypto-wire'
import { WALNUT_ADMIN_KEY_STORE } from './rsa.ports'

/**
 * RSA 请求解密 / 响应加密（libs 解耦批 5 从 `modules/security/rsa/` 下沉）。
 *
 * 密钥材料来自 `libs/app-domain` 的 `AppKeyService`，经 `WALNUT_ADMIN_KEY_STORE` 端口注入
 * （实现绑定在 @Global 的 AppKeyModule；`implements` 作编译期守护）。
 */
@Injectable()
export class SecurityRsaService {
  constructor(
    private readonly cacheRsaService: AppTechCacheRsaService,
    @Inject(WALNUT_ADMIN_KEY_STORE)
    private readonly keyStore: IWalnutAdminKeyStore,
  ) {}

  async getCurrentRsaPublicKey() {
    const target = await this.keyStore.getCurrent(AppKeyTypeConst.RSA_PAIR)
    return target.publicKeyPem
  }

  async getCurrentRsaPrivateKey() {
    // P0-6（2026-10-28）：getCurrent 的 HTTP 视图已剔除私钥 —— 内部解密走实体通道
    const target = await this.keyStore.getCurrentActiveKey(AppKeyTypeConst.RSA_PAIR)
    return target?.meta?.privateKeyPem
  }

  /**
   * @description encrypt response value with client RSA public key
   */
  async encryptResponseValueWithClientRsaPubKey(deviceId: string, value: string) {
    // 1. Get current client RSA public key from redis/db
    const clientRsaPubKey = await this.cacheRsaService.getRsaPubKeyCache(deviceId)

    // 2. Generate one-time AES-256-GCM key and IV
    const aesKey = randomBytes(AES_GCM_WIRE.KEY_LENGTH)
    const iv = randomBytes(AES_GCM_WIRE.IV_LENGTH)

    // 3. AES-GCM encrypt value
    const cipher = createCipheriv('aes-256-gcm', aesKey, iv)
    const ct = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ])
    const tag = cipher.getAuthTag() // TAG_LENGTH bytes

    // 4. Concatenate key|iv|tag into a 60-byte blob and encrypt with RSA public key
    const keyBlob = Buffer.concat([aesKey, iv, tag])
    const encKey = publicEncrypt(
      {
        key: clientRsaPubKey!,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      keyBlob,
    )

    const payload = {
      cipher: ct.toString('base64'),
      key: encKey.toString('base64'),
    }

    return Buffer.from(JSON.stringify(payload)).toString('base64')
  }

  /**
   * @description decrypt request value through RSA private key in app key
   */
  async decryptRequestValueWIthServerRsaPrivKey(value: string) {
    interface CipherEnvelope {
      enc: 'AES_256_GCM'
      key: string
      iv: string
      ct: string
      tag: string
    }

    const payload = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as CipherEnvelope

    const iv = Buffer.from(payload.iv, 'base64')
    const ciphertext = Buffer.from(payload.ct, 'base64')
    const tag = Buffer.from(payload.tag, 'base64')

    const buffer = Buffer.from(payload.key, 'base64')
    const rsaPrivateKey = await this.getCurrentRsaPrivateKey()

    try {
      const aesKey = privateDecrypt(
        {
          key: rsaPrivateKey!,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        buffer,
      )

      const decipher = createDecipheriv('aes-256-gcm', aesKey, iv)
      decipher.setAuthTag(tag)

      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ])

      return plaintext.toString('utf8')
    }
    catch {
      throw new WalnutAdminExceptionRsaDecryptFailed()
    }
  }
}
