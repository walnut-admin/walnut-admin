import * as crypto from 'node:crypto'
import { Injectable } from '@nestjs/common'

/**
 * MFA 辅助工具服务
 * 专门用于 MFA 模块的工具函�?
 */
@Injectable()
export class SysUserMfaHelperService {
  /**
   * 生成备用恢复�?
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
    // 排除易混淆字�? 0/O, 1/I/L
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

    for (let i = 0; i < count; i++) {
      const parts: string[] = []

      for (let s = 0; s < segments; s++) {
        let part = ''
        for (let j = 0; j < length; j++) {
          // 使用 crypto.randomInt 提高随机�?
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
   * @param code 备用�?
   */
  formatBackupCode(code: string): string {
    // 移除所有非字母数字字符，转大写
    const clean = code.replace(/[^A-Z0-9]/gi, '').toUpperCase()

    // �?个字符分�?
    const segments = clean.match(/.{1,4}/g) || []
    return segments.join('-')
  }

  /**
   * 验证备用码格�?
   * @param code 用户输入的备用码
   */
  validateBackupCodeFormat(code: string): boolean {
    const clean = code.replace(/[^A-Z0-9]/gi, '')
    // 标准格式�?2个字符（3�?x 4字符�?
    return clean.length === 12
  }
}
