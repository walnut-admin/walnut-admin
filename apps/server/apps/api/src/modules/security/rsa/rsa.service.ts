import { Buffer } from 'node:buffer'
import { constants, createCipheriv, createDecipheriv, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto'

import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminExceptionRsaDecryptFailed } from '@walnut/exceptions/business/rsa'
import { AppKeyService } from '@/modules/app/key/key.service'
import { AppTechCacheRsaService } from '@/modules/techniques/cache/service/cache.rsa'

@Injectable()
export class SecurityRsaService {
  private readonly logger = new Logger(SecurityRsaService.name)

  constructor(
    private readonly cacheRsaService: AppTechCacheRsaService,
    private readonly appKeyService: AppKeyService,
  ) {}

  async getCurrentRsaPublicKey() {
    const target = await this.appKeyService.getCurrent('RSA_PAIR')
    return target.publicKeyPem
  }

  async getCurrentRsaPrivateKey() {
    const target = await this.appKeyService.getCurrent('RSA_PAIR')
    return target.privateKeyPem
  }

  /**
   * @description encrypt response value with client RSA public key
   */
  async encryptResponseValueWithClientRsaPubKey(deviceId: string, value: string) {
    // 1. Get current client RSA public key from redis/db
    const clientRsaPubKey = await this.cacheRsaService.getRsaPubKeyCache(deviceId)

    // 2. Generate one-time AES-256-GCM key and IV
    const aesKey = randomBytes(32)
    const iv = randomBytes(12)

    // 3. AES-GCM encrypt value
    const cipher = createCipheriv('aes-256-gcm', aesKey, iv)
    const ct = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ])
    const tag = cipher.getAuthTag() // 16 bytes

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

  rotate() {
    const version = Date.now().toString()
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })

    this.logger.log(`RSA key rotated: ${version}`)
    return { ...pair, version }
  }
}
