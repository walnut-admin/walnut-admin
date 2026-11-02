import { Buffer } from 'node:buffer'
import * as crypto from 'node:crypto'
import { Injectable } from '@nestjs/common'

/**
 * 备用码哈希的固定域（P3-23，2026-10-29）：确定性哈希才能与用户输入比对 ——
 * 域串 + userId 一起参与摘要，防跨用户彩虹表；域串版本化，未来换算法时可识别存量。
 */
const BACKUP_CODE_HASH_DOMAIN = 'walnut-admin/mfa/backup-code/v1'

/**
 * MFA 辅助工具服务
 * 专门用于 MFA 模块的工具函数
 */
@Injectable()
export class SysUserMfaHelperService {
  /**
   * 生成备用恢复码
   * @param count 生成数量
   * @param length 每段长度
   * @param segments 分段数量
   */
  generateBackupCodes(
    count = 10,
    length = 4,
    segments = 3,
  ): string[] {
    const codes: string[] = []
    // 排除易混淆字符：0/O, 1/I/L
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

    for (let i = 0; i < count; i++) {
      const parts: string[] = []

      for (let s = 0; s < segments; s++) {
        let part = ''
        for (let j = 0; j < length; j++) {
          // 使用 crypto.randomInt 提高随机性
          const index = crypto.randomInt(0, chars.length)
          part += chars[index]
        }
        parts.push(part)
      }

      codes.push(parts.join('-'))
    }

    return codes
  }

  /**
   * 格式化备用码（用于展示）
   * @param code 备用码
   */
  formatBackupCode(code: string): string {
    // 移除所有非字母数字字符，转大写
    const clean = code.replace(/[^A-Z0-9]/gi, '').toUpperCase()

    // 每 4 个字符分段
    const segments = clean.match(/.{1,4}/g) || []
    return segments.join('-')
  }

  /**
   * 验证备用码格式
   * @param code 用户输入的备用码
   */
  validateBackupCodeFormat(code: string): boolean {
    const clean = code.replace(/[^A-Z0-9]/gi, '')
    // 标准格式：12 个字符（3 段 x 4 字符）
    return clean.length === 12
  }

  /**
   * 备用码确定性哈希（P3-23，2026-10-29）。
   *
   * 旧实现 `cryptoService.hash(code)` 每次生成随机盐 —— 校验时用新盐重算，必然 miss，
   * 备用码从来不可用。这里改为固定域 + userId 的 SHA-256（确定性），绑定用户维度，
   * 跨用户的相同备用码不会得到相同摘要。存储侧仍由调用方对哈希再加密。
   */
  hashBackupCode(userId: string, formattedCode: string): string {
    return crypto
      .createHash('sha256')
      .update(`${BACKUP_CODE_HASH_DOMAIN}:${userId}:${formattedCode}`, 'utf8')
      .digest('hex')
  }

  /**
   * 常量时间比对备用码哈希（防时序侧信道）
   */
  verifyBackupCodeHash(userId: string, formattedCode: string, storedHash: string): boolean {
    const computed = this.hashBackupCode(userId, formattedCode)

    if (computed.length !== storedHash.length) {
      return false
    }

    return crypto.timingSafeEqual(
      Buffer.from(computed, 'utf8'),
      Buffer.from(storedHash, 'utf8'),
    )
  }
}
