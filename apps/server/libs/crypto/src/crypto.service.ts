import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AES_GCM_WIRE } from '@walnut/contract/crypto-wire'
import { isNil } from 'lodash'

@Injectable()
export class AppTechCryptoService {
  private readonly algorithm = 'aes-256-gcm'
  private readonly IV_LENGTH = AES_GCM_WIRE.IV_LENGTH
  private readonly AUTH_TAG_LENGTH = AES_GCM_WIRE.TAG_LENGTH

  constructor(private readonly configService: ConfigService) {}

  /**
   * 加密文本
   * @param text 明文
   * @param encryptKey 加密密钥配置名，指向环境变量或数据库中的 base64 格式字符串
   * @param aad 附加认证数据（可选），如租户ID、表名等，用于防跨租户重放攻击
   * @returns base64 编码的二进制数据（iv + ciphertext + authTag）
   */
  encrypt(text: string, encryptKey: string, aad?: string): string {
    const envKey = this.configService.get(encryptKey) as string
    if (envKey === null) {
      throw new Error(`Encrypt key ${encryptKey} not found in environment variables`)
    }
    const key = Buffer.from(envKey, 'base64')
    const iv = crypto.randomBytes(this.IV_LENGTH)
    const cipher = crypto.createCipheriv(this.algorithm, key, iv)

    // 如果提供了 AAD，添加到认证数据中
    if (!isNil(aad)) {
      cipher.setAAD(Buffer.from(aad, 'utf8'))
    }

    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final(),
    ])
    const authTag = cipher.getAuthTag()

    // 直接按二进制顺序拼接：iv || ciphertext || authTag
    const result = Buffer.concat([iv, encrypted, authTag])

    // 返回 base64 编码，便于存储和传输
    return result.toString('base64')
  }

  /**
   * 解密文本
   * @param encryptedText base64 编码的密文
   * @param encryptKey 加密密钥配置名
   * @param aad 附加认证数据（必须与加密时一致）
   */
  decrypt(encryptedText: string, encryptKey: string, aad?: string): string {
    const envKey = this.configService.get(encryptKey) as string
    if (envKey === null) {
      throw new Error(`Decrypt key ${encryptKey} not found in environment variables`)
    }
    const key = Buffer.from(envKey, 'base64')
    const data = Buffer.from(encryptedText, 'base64')

    // 校验长度
    if (data.length < this.IV_LENGTH + this.AUTH_TAG_LENGTH) {
      throw new Error('Invalid encrypted data: too short')
    }

    // 按顺序提取：iv || ciphertext || authTag
    const iv = data.subarray(0, this.IV_LENGTH)
    const authTag = data.subarray(data.length - this.AUTH_TAG_LENGTH)
    const encrypted = data.subarray(this.IV_LENGTH, data.length - this.AUTH_TAG_LENGTH)

    const decipher = crypto.createDecipheriv(this.algorithm, key, iv)
    decipher.setAuthTag(authTag)

    if (!isNil(aad)) {
      decipher.setAAD(Buffer.from(aad, 'utf8'))
    }

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ])

    return decrypted.toString('utf8')
  }

  /**
   * 生成 HMAC 哈希 —— 用于**不可逆查找键**，不是身份根
   *
   * 现存唯一生产调用方是 `AppUserIdentitySharedService.generateValueHash`
   * （`user_identity.shared.service.ts:64`，盐 = `USER_ID_HASH_SALT`，结果落
   * `sys_user_identity.value_hash`，按身份值快查）。**别把它当设备身份的派生口**：
   * 14-D 起 deviceId 与指纹都不走这里 —— deviceId 由服务端随机签发（B5），
   * 指纹只作风控特征、不参与任何身份计算。
   *
   * @param text 原始数据
   * @param salt 盐值（可选，默认生成）
   * @param encoding 输出编码格式，默认 hex
   */
  hash(
    text: string,
    salt?: string,
    encoding: 'hex' | 'base64' = 'hex',
  ): string {
    if (isNil(salt)) {
      salt = this.generateSalt()
    }
    return crypto
      .createHmac('sha256', salt)
      .update(text)
      .digest(encoding)
  }

  /**
   * 生成密钥（用于初始化环境变量）
   * 示例：生成 AES-256 密钥（32 字节）
   */
  generateKey(): string {
    return crypto.randomBytes(32).toString('base64')
  }

  /**
   * 生成盐值（用于初始化环境变量）
   */
  generateSalt(): string {
    return crypto.randomBytes(32).toString('base64')
  }
}
