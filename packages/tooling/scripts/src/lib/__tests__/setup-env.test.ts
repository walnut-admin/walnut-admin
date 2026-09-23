/**
 * `setup-env` 的两处纯字符串变换（dotenvx 加解密流程里最容易出错的地方，源码注释明写「导出以便单测」）。
 *
 * 导入路径跨层：模块在 `src/env/`，用例按「与所测模块同层的 __tests__」放在 `src/lib/__tests__/`。
 */

import { describe, expect, it } from 'vitest'
import { ENTRIES, envFileName, rebuildKeysFile, stripPublicKeyHeaderContent } from '../../env/setup-env.ts'

const BANNER = ['#/-------------------------------------#', '#/ 这是 dotenvx 生成的固定头（banner）  #', '#/--------------------------------------#']

describe('envFileName —— 带后缀与不带后缀两种', () => {
  it('env 为空串 ⇒ 基础 .env（admin 构建必填的 VITE_* 变量）', () => {
    expect(envFileName({ app: 'admin', env: '' })).toBe('.env')
  })

  it('env 非空 ⇒ .env.<环境>', () => {
    expect(envFileName({ app: 'admin', env: 'development' })).toBe('.env.development')
    expect(envFileName({ app: 'server', env: 'production' })).toBe('.env.production')
    expect(envFileName({ app: 'server', env: 'stage' })).toBe('.env.stage')
  })

  it('清单里只有 admin 有基础 .env（它必须随仓库加密分发，否则 CI 构建取不到）', () => {
    expect(ENTRIES.filter(entry => entry.env === '').map(entry => entry.app)).toEqual(['admin'])
    expect(new Set(ENTRIES.map(entry => entry.app))).toEqual(new Set(['admin', 'server']))
  })
})

describe('rebuildKeysFile —— 重建 .env.keys', () => {
  const TMP_KEYS = [
    ...BANNER,
    '',
    'DOTENV_PRIVATE_KEY_PRODUCTION="ec9e,d4a1"',
    'DOTENV_PRIVATE_KEY_PRODUCTION="d4a1,f7b2"',
    'DOTENV_PRIVATE_KEY_STAGE="a1b2"',
    'DOTENV_PRIVATE_KEY="base-key"',
  ].join('\n')

  it('banner 原样保留（含它后面的空行）', () => {
    const output = rebuildKeysFile(TMP_KEYS)
    expect(output.startsWith(`${BANNER.join('\n')}\n`)).toBe(true)
  })

  it('同名环境出现两次 ⇒ 逗号合并并去重', () => {
    expect(rebuildKeysFile(TMP_KEYS)).toContain('DOTENV_PRIVATE_KEY_PRODUCTION="ec9e,d4a1,f7b2"')
  })

  it('无后缀（基础 .env）与带后缀的 key 落在各自的行上', () => {
    const lines = rebuildKeysFile(TMP_KEYS).split('\n').filter(line => line.startsWith('DOTENV_PRIVATE_KEY'))
    expect(lines).toEqual([
      'DOTENV_PRIVATE_KEY="base-key"',
      'DOTENV_PRIVATE_KEY_PRODUCTION="ec9e,d4a1,f7b2"',
      'DOTENV_PRIVATE_KEY_STAGE="a1b2"',
    ])
    // 每行前面的注释说明它属于哪个文件
    expect(rebuildKeysFile(TMP_KEYS)).toContain('# .env\nDOTENV_PRIVATE_KEY="base-key"')
    expect(rebuildKeysFile(TMP_KEYS)).toContain('# .env.production\nDOTENV_PRIVATE_KEY_PRODUCTION=')
    expect(rebuildKeysFile(TMP_KEYS)).toContain('# .env.stage\nDOTENV_PRIVATE_KEY_STAGE=')
  })

  it('确定性与顺序稳定：同名环境的行序颠倒不改变输出', () => {
    const shuffled = [
      ...BANNER,
      '',
      'DOTENV_PRIVATE_KEY="base-key"',
      'DOTENV_PRIVATE_KEY_STAGE="a1b2"',
      'DOTENV_PRIVATE_KEY_PRODUCTION="ec9e,d4a1"',
      'DOTENV_PRIVATE_KEY_PRODUCTION="d4a1,f7b2"',
    ].join('\n')
    expect(rebuildKeysFile(TMP_KEYS)).toBe(rebuildKeysFile(TMP_KEYS))
    expect(rebuildKeysFile(shuffled)).toBe(rebuildKeysFile(TMP_KEYS))
  })

  it('值里的引号被剥掉，输出以单个换行结尾', () => {
    const output = rebuildKeysFile(TMP_KEYS)
    expect(output).not.toContain('"ec9e,d4a1,f7b2""')
    expect(output.endsWith('\n')).toBe(true)
    expect(output.endsWith('\n\n')).toBe(false)
  })

  it('# .env.* 形式的文件注释不算 banner（只有 #/ 开头与空行算）', () => {
    const output = rebuildKeysFile(['# .env.production', 'DOTENV_PRIVATE_KEY_PRODUCTION="k1"', ''].join('\n'))
    expect(output.startsWith('# .env.production\n')).toBe(false)
    expect(output).toContain('DOTENV_PRIVATE_KEY_PRODUCTION="k1"')
  })
})

describe('stripPublicKeyHeaderContent —— 去掉 dotenvx 的 7 行元数据头', () => {
  const DECRYPTED = [
    ...BANNER,
    '#/ 这是解密产物，请勿提交 #',
    'DOTENV_PUBLIC_KEY="03a1b2c3"',
    '',
    'VITE_APP_TITLE=Walnut Admin',
    '# 第一个真实变量之后的注释必须留着',
    'VITE_API_BASE=/w/v1',
    '',
    '',
  ].join('\n')

  it('开头的 #/、注释、DOTENV_PUBLIC_KEY 与空行全部去掉', () => {
    const output = stripPublicKeyHeaderContent(DECRYPTED)
    expect(output).not.toContain('DOTENV_PUBLIC_KEY')
    expect(output).not.toContain('#/')
    expect(output.startsWith('VITE_APP_TITLE=Walnut Admin')).toBe(true)
  })

  it('第一个真实变量**之后**的注释原样保留', () => {
    expect(stripPublicKeyHeaderContent(DECRYPTED)).toContain('# 第一个真实变量之后的注释必须留着')
  })

  it('输出以恰好一个换行结尾', () => {
    const output = stripPublicKeyHeaderContent(DECRYPTED)
    expect(output.endsWith('\n')).toBe(true)
    expect(output.endsWith('\n\n')).toBe(false)
    expect(output).toBe([
      'VITE_APP_TITLE=Walnut Admin',
      '# 第一个真实变量之后的注释必须留着',
      'VITE_API_BASE=/w/v1',
      '',
    ].join('\n'))
  })

  it('没有任何真实变量时不乱删（返回 trim 后的内容）', () => {
    expect(stripPublicKeyHeaderContent('# 只有注释\n\n')).toBe('# 只有注释\n')
  })
})
