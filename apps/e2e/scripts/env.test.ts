/**
 * ⑤（2026-11 F2）的回归锚点：cookie 签名密钥在**两种解析器**下同值。
 *
 * 服务端用 dotenv（未加引号的值在第一个 `#` 处截断），E2E 用 `parseEnvFile`（原样读）。
 * 历史上 `.env.stage` 的 `APP_COOKIE_SECRET` 含 `#`，两边读到的值不同 —— U13b 只能
 * 复刻一套截断解析。换值后约定是「值里没有 `#`」，这里把它钉成机械判据：
 * 谁再换回含 `#` 的值，这条用例当场红（而不是等到 U13b 40111 变成 40117 才发现）。
 *
 * 依赖解密后的 env-local：干净检出 / fork PR 里没有该文件 ⇒ 按「不适用」跳过
 * （与其它门禁的 `it.skipIf` 口径一致，不把「没解密」读成「验过了」）。
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readServerCookieSecret, readServerStageEnv, SERVER_STAGE_ENV_FILE } from './env.ts'

describe('readServerCookieSecret（⑤）', () => {
  it.skipIf(!existsSync(SERVER_STAGE_ENV_FILE))(
    '与 readServerStageEnv 同值，且不含 #（两套解析器不再分歧）',
    () => {
      const value = readServerCookieSecret()

      expect(value).toBe(readServerStageEnv().APP_COOKIE_SECRET)
      expect(
        value.includes('#'),
        '.env.stage 的 APP_COOKIE_SECRET 不能含未加引号的 #（dotenv 会截断）',
      ).toBe(false)
      expect(value.length).toBeGreaterThanOrEqual(32)
    },
  )
})
