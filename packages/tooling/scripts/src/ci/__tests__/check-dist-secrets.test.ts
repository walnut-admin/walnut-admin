/**
 * `check-dist-secrets.ts` 的用例。
 *
 * 这里最该防的不是"漏了某条规则"，而是**两条会让这个门禁变成噪音或变成泄漏源的失败**：
 *
 * 1. **误报**：每条规则的"反例"都来自**真产物**（`apps/admin/dist`）实测 —— 裸 PEM 头、
 *    `password:`xxx``、内联 data-URI。它们必须**不**被报出来，否则这个门禁上线第一天就被关掉。
 * 2. **回显机密**：finding 文本会进 CI 日志（公开面），所以**任何**输出里都不许出现那个值。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  collectFindings,
  collectSecretValues,
  findLeakedValues,
  parseSecretValues,
  scanDist,
  scanText,
  stripPrecompressed,
} from '../check-dist-secrets.ts'

/**
 * ⚠️ **云厂商 AK 的假样本刻意"拼"出来，不要"简化"成字面量。**
 *
 * 2026-09-23 实测踩过：第一版直接写了腾讯云文档里那个样本 SecretId（`AKID` + 32 位），
 * **GitHub 的 push protection 当场把整个 push 拦下**（它认得那是「Tencent Cloud Secret ID」，
 * 分不出样本与真货）：
 *
 * ```text
 * remote:  Push cannot contain secrets
 * remote:    - commit: d5c0d5c  path: …/check-dist-secrets.test.ts:52
 * remote:       —— Tencent Cloud Secret ID ——
 * ```
 *
 * 值本身**不是真凭据**（它是腾讯云公开文档里的样例），所以不需要轮换；但**必须从文件里拿掉**，
 * 否则那一道闸会一直拦。拼装之后文件文本里不再出现任何 `AKID…` 连续串，检测器就无从命中。
 * 这条约束对**所有**测试夹具都成立：**假样本也不能长成真凭据的形状**。
 */
const fakeAwsAk = `AKIA${'IOSFODNN7EXAMPLE'}`
const fakeTencentAk = `AKID${'x'.repeat(32)}`

describe('scanText —— 形态规则', () => {
  it('真私钥（头 + base64 正体）→ 报', () => {
    const key = `-----BEGIN PRIVATE KEY-----\n${'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ'.repeat(4)}\n-----END PRIVATE KEY-----`
    expect(scanText(key, 'a.js').map(f => f.rule)).toEqual(['pem-private-key'])
  })

  // 反例，来自真产物：WebCrypto 导出 PEM 时用的模板常量
  it('裸 PEM 头（真产物里那次误报）→ 不报', () => {
    const template = 'PREFIX:`-----BEGIN PRIVATE KEY-----`,SUFFIX:`-----END PRIVATE KEY-----`'
    expect(scanText(template, 'a.js')).toEqual([])
  })

  it('带凭据的连接串 → 报；不带凭据的 / 只有主机名的 → 不报', () => {
    expect(scanText('mongodb://root:s3cr3t@db:27017/x', 'a.js').map(f => f.rule)).toEqual(['credential-uri'])
    expect(scanText('redis://:pw@r:6379', 'a.js').map(f => f.rule)).toEqual(['credential-uri'])
    expect(scanText('http://backend:3000/w/v1/', 'a.js')).toEqual([])
    expect(scanText('mongodb://db:27017/x', 'a.js')).toEqual([])
  })

  it('jWT 三段 → 报', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    expect(scanText(jwt, 'a.js').map(f => f.rule)).toEqual(['jwt'])
  })

  it('云厂商 AK 形状 → 报（AWS / 腾讯云各一）', () => {
    expect(scanText(fakeAwsAk, 'a.js').map(f => f.rule)).toEqual(['cloud-access-key'])
    expect(scanText(fakeTencentAk, 'a.js').map(f => f.rule)).toEqual(['cloud-access-key'])
  })

  // 反例，来自真产物：内联的 data-URI 图片长这样
  it('长 base64（data-URI 图片，真产物里 5 次误报）→ 不报', () => {
    expect(scanText(`url(data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUg'.repeat(12)})`, 'a.css')).toEqual([])
  })

  it('finding 里带上文件与规则名（便于定位），且不回显匹配到的东西', () => {
    const [finding] = scanText(fakeAwsAk, 'static/js/x.js')
    expect(finding!.file).toBe('static/js/x.js')
    expect(finding!.detail).not.toContain(fakeAwsAk)
  })
})

describe('stripPrecompressed / 敏感文件名', () => {
  it('预压缩后缀要先去掉，否则 `.env.br` 会漏', () => {
    expect(stripPrecompressed('a.js.br')).toBe('a.js')
    expect(stripPrecompressed('a.js.gz')).toBe('a.js')
    expect(stripPrecompressed('a.js')).toBe('a.js')
  })

  it('产物里出现 .env / 私钥文件 → 报（比内容扫描更硬）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dist-'))
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'assets', '.env.production'), 'A=1\n')
    writeFileSync(join(dir, 'assets', 'server.pem.gz'), 'x')
    writeFileSync(join(dir, 'assets', 'app.js'), 'var a=1')
    const { findings } = scanDist(dir, join(dir, 'no-such-env'))
    expect(findings.map(f => f.rule)).toEqual(['bad-file-name', 'bad-file-name'])
    expect(findings.every(f => f.rule !== 'env-value-leak')).toBe(true)
  })
})

describe('parseSecretValues —— 键名判定', () => {
  const env = [
    'APP_COOKIE_SECRET=abcdefghijklmnop',
    'DATABASE_PASS=hunter2hunter2',
    'JWT_ACCESS_TOKEN_SECRET=tok_tok_tok_tok',
    'MFA_ENCRYPTION_KEY=mfa_key_value_123',
    'USER_ID_HASH_SALT=salt_value_12345',
    'VENDOR_KEYS_ALI_OSS_SECRET=oss_secret_value',
    // 下面这些**必须不进**机密集（实测误报源 + 前端本来就要用）
    'VENDOR_KEYS_ALI_OSS_BUCKET=walnut-public-bucket',
    'VENDOR_KEYS_ALI_OSS_REGION=oss-cn-hangzhou',
    'VENDOR_KEYS_TX_SMS_SDK_APP_ID=1400123456',
    'APP_PORT=3000',
    'APP_I18N_FALLBACK=true',
    'JWT_ACCESS_TOKEN_EXPIRE=604800',
    'SHORT_PASS=abc',
  ].join('\n')

  it('只挑键名像机密的，且跳过太短 / 布尔 / 纯数字的值', () => {
    const keys = parseSecretValues(env, '.env.production').map(s => s.key)
    expect(keys).toEqual([
      'APP_COOKIE_SECRET',
      'DATABASE_PASS',
      'JWT_ACCESS_TOKEN_SECRET',
      'MFA_ENCRYPTION_KEY',
      'USER_ID_HASH_SALT',
      'VENDOR_KEYS_ALI_OSS_SECRET',
    ])
  })

  it('键名判定**不能**放宽到裸 `KEY` / `ACCESS`（真产物里 6 条误报的成因）', () => {
    const keys = parseSecretValues('VENDOR_KEYS_ALI_OSS_BUCKET=b\nVENDOR_KEYS_ALI_OSS_REGION=r\n', 'x').map(s => s.key)
    expect(keys).toEqual([])
  })

  it('去掉包裹的引号', () => {
    expect(parseSecretValues('APP_COOKIE_SECRET="quoted-value-1"', 'x')[0]!.value).toBe('quoted-value-1')
  })
})

describe('findLeakedValues —— 最硬的那条', () => {
  const secret = { key: 'JWT_ACCESS_TOKEN_SECRET', value: 'super-secret-token-value', source: '.env.production' }

  it('产物里出现真值 → 报，且报的是键名不是值', () => {
    const [finding] = findLeakedValues(`var x="${secret.value}"`, 'static/js/a.js', [secret])
    expect(finding!.rule).toBe('env-value-leak')
    expect(finding!.detail).toContain('JWT_ACCESS_TOKEN_SECRET')
    // ⚠️ finding 会进 CI 日志（公开面）—— 值一个字符都不许出现在里面
    expect(finding!.detail).not.toContain('super-secret-token-value')
    expect(JSON.stringify(finding)).not.toContain('super-secret-token-value')
  })

  it('没出现 → 不报', () => {
    expect(findLeakedValues('var x="public"', 'a.js', [secret])).toEqual([])
  })

  it('env 目录不存在 → 机密集为空（降级成只跑形状规则，不是报错）', () => {
    expect(collectSecretValues(join(tmpdir(), 'definitely-not-here-9f8a7b'))).toEqual([])
  })
})

describe('collectFindings —— 前置条件', () => {
  it('产物目录不存在 → 前置条件未满足（不是"通过"）', () => {
    const result = collectFindings(join(tmpdir(), 'no-such-dist-4c1d2e'))
    expect(result.precondition).toBeDefined()
    expect(result.findings).toEqual([])
  })
})
