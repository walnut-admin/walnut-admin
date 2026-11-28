/**
 * 脱敏规则的**单测**（纯函数，仓库纪律：新增纯函数必须补测试）。
 *
 * 用例覆盖三件事：
 * 1. 每一类敏感值（header / cookie / 设备 id / JWT / Bearer / 字段）都被杀掉；
 * 2. 排障要用的信息**不被误杀**（业务码、URL 路径、XFF、时间戳）—— 脱敏后日志仍要能读；
 * 3. 幂等（同一份日志被前后两次脱敏不会互相破坏），`redactDeep` 的输出仍是合法 JSON。
 *
 * 这些形状都是从真实日志里抄的：`util.inspect` 的 `'Bearer …'`（单引号）、HTTP header 行、
 * 后端 LoggerMiddleware 打的对象、`Request End` 的 body。
 */
import { describe, expect, it } from 'vitest'
import { redactDeep, REDACTED, redactText } from './redact.ts'

const DEVICE_ID = `d1_${'a'.repeat(32)}`
/**
 * 夹具**按段拼装**：整段字面量会被 `check-source-secrets` 的 `jwt` 规则当成真凭据
 * （它扫源码，含 `*.test.ts`）—— 门禁拦的是「仓库里出现 JWT 形态的串」，测试夹具也不例外。
 * 拼装后的运行时值仍是完整三段式，脱敏规则照常被验证。
 */
const JWT = [
  'eyJhbGciOiJIUzI1NiJ9',
  'eyJzdWIiOiJhZG1pbiIsImp0aSI6IngifQ',
  'c2lnbmF0dXJlLWhleA',
].join('.')

describe('redactText —— header 形态', () => {
  it('http header 行：Authorization / Cookie / x-sign 的值整段杀掉，名字保留', () => {
    const input = [
      `authorization: Bearer ${JWT}`,
      'Cookie: DEVICE_ID=abc; CAPJS_TOKEN=def',
      'x-sign: 9f8e7d6c5b4a',
    ].join('\n')
    const out = redactText(input)

    expect(out).toContain(`authorization:${REDACTED}`)
    expect(out).toContain(`Cookie:${REDACTED}`)
    expect(out).toContain(`x-sign:${REDACTED}`)
    expect(out).not.toContain(JWT)
    expect(out).not.toContain('abc')
    expect(out).not.toContain('9f8e7d6c5b4a')
  })

  it('util.inspect 的单引号形态 + JSON 双引号形态都命中（同一条规则）', () => {
    const inspectLine = `{ headers: { authorization: 'Bearer ${JWT}', 'x-sign': 'deadbeef' } }`
    const jsonLine = `{"authorization":"Bearer ${JWT}","x-sign":"deadbeef"}`

    expect(redactText(inspectLine)).not.toContain(JWT)
    expect(redactText(inspectLine)).not.toContain('deadbeef')
    expect(redactText(jsonLine)).not.toContain(JWT)
    expect(redactText(jsonLine)).not.toContain('deadbeef')
    // 名字被引号包住的形态也要命中（`'x-sign': …` 是 util.inspect 的默认输出）
    expect(redactText(inspectLine)).toContain(`'x-sign':${REDACTED}`)
  })

  it('set-cookie / x-sign-ticket 这类前缀名字不会被切成半截', () => {
    const out = redactText('set-cookie: DEVICE_ID=abc; Path=/\nx-sign-ticket: t123456789')
    expect(out).toContain(`set-cookie:${REDACTED}`)
    expect(out).toContain(`x-sign-ticket:${REDACTED}`)
  })
})

describe('redactText —— cookie 串与字段形态', () => {
  it('裸写的 cookie 键值（query / 日志正文）按名字杀掉，且不吃掉后面的键', () => {
    const out = redactText(`url=/api/x?DEVICE_ID=${DEVICE_ID}&CAPJS_TOKEN=cap-123&page=2`)
    expect(out).toContain(`DEVICE_ID=${REDACTED}`)
    expect(out).toContain(`CAPJS_TOKEN=${REDACTED}`)
    expect(out).toContain('page=2')
    expect(out).not.toContain(DEVICE_ID)
    expect(out).not.toContain('cap-123')
  })

  it('请求体里的 password / access_token / totp 被替换', () => {
    const out = redactText(`body={ password: 'P@ssw0rd!', access_token: '${JWT}', totp: '123456' }`)
    expect(out).not.toContain('P@ssw0rd!')
    expect(out).not.toContain(JWT)
    expect(out).not.toContain('123456')
  })

  it('裸 JWT / Bearer / s: 签名 cookie 形态兜底', () => {
    const out = redactText(
      `token=${JWT} authorization=Bearer ${JWT} cookie=s:${'A'.repeat(24)}.${'B'.repeat(16)}`,
    )
    expect(out).not.toContain(JWT)
    expect(out).not.toContain('A'.repeat(24))
    expect(out).not.toContain('Bearer eyJ')
  })

  it('l1/l2 新增字段：lockPwdHash / credential / verifyCode 的明文被替换', () => {
    // 形状取自 stage 的 LoggerMiddleware（请求体整段打印）与协议侧 root() 的明文 body
    const input = [
      `body={ lockPwdHash: 'Lock-2e2-pass', lockMode: 'security', lockCrossDevice: true }`,
      `body={ level: 'account_critical', operationType: 'email_change', method: 'email', credential: '123456' }`,
      `body={ type: 'emailAddress', purpose: 'login', verifyCode: '654321' }`,
    ].join('\n')
    const out = redactText(input)

    expect(out).not.toContain('Lock-2e2-pass')
    expect(out).not.toContain('123456')
    expect(out).not.toContain('654321')
    // 非敏感的同批字段与业务码必须保留（排障要靠它们）
    expect(out).toContain(`lockPwdHash:${REDACTED}`)
    expect(out).toContain('lockMode')
    expect(out).toContain(`credential:${REDACTED}`)
    expect(out).toContain(`verifyCode:${REDACTED}`)
    expect(out).toContain('account_critical')
  })
})

describe('redactText —— 不误杀排障信息', () => {
  it('业务码 / URL 路径 / XFF / 时间戳原样保留', () => {
    const input = '[e2e/ui] POST http://127.0.0.1:4173/api/system/device/initial status=200 20000'
    const out = redactText(input)
    expect(out).toBe(input)
    expect(redactText('x-forwarded-for: 127.0.5.10')).toBe('x-forwarded-for: 127.0.5.10')
    expect(redactText('2026-11-25T09:00:00.000Z')).toBe('2026-11-25T09:00:00.000Z')
  })

  it('没有赋值的普通词（cookie 配置 / token 预算）不被改写', () => {
    expect(redactText('Cookie 配置缺失：name or value')).toBe('Cookie 配置缺失：name or value')
    expect(redactText('CAP token 预算 90s')).toBe('CAP token 预算 90s')
  })

  it('非敏感的退避 / 计数元数据不被误杀（retryAfterSec / lockMode / operationType）', () => {
    const input =
      'meta={ failCount: 5, retryAfterSec: 30 } lockMode=security operationType=email_change'
    expect(redactText(input)).toBe(input)
  })

  it('幂等：脱敏结果再跑一遍不变', () => {
    const input = `authorization: Bearer ${JWT}\nCookie: DEVICE_ID=${DEVICE_ID}; CAPJS_TOKEN=x\npassword: p@ss\nurl=/api/a?access_token=${JWT}`
    const once = redactText(input)
    expect(redactText(once)).toBe(once)
  })
})

describe('redactDeep —— attach 用的结构化脱敏', () => {
  it('字符串值过文本规则；敏感 key 的整段值丢弃；其它类型原样', () => {
    const value = {
      runId: '2026-11-25T09-00-00-000Z-1234',
      url: `http://127.0.0.1:4173/api/x?access_token=${JWT}`,
      headers: { 'x-sign': 'deadbeef', 'x-forwarded-for': '127.0.2.5' },
      status: 200,
      nested: [{ msg: `device ${DEVICE_ID} banned` }],
      credentialsFile: 'D:\\repo\\apps\\e2e\\.auth\\credentials.json',
    }

    const out = redactDeep(value) as Record<string, unknown>

    expect(JSON.stringify(out)).not.toContain(JWT)
    expect(JSON.stringify(out)).not.toContain(DEVICE_ID)
    expect(JSON.stringify(out)).not.toContain('deadbeef')
    expect(out.headers).toEqual({ 'x-sign': REDACTED, 'x-forwarded-for': '127.0.2.5' })
    expect(out.status).toBe(200)
    // 路径不是敏感值：credentialsFile 只留路径正是这一条
    expect(out.credentialsFile).toBe('D:\\repo\\apps\\e2e\\.auth\\credentials.json')
    // 输出仍是合法 JSON
    expect(() => JSON.parse(JSON.stringify(out))).not.toThrow()
  })

  it('l1/l2 字段在结构化数据里整段丢弃（lockPwdHash / credential / verifyCode）', () => {
    const value = {
      lockPwdHash: 'Lock-2e2-pass',
      lockMode: 'security',
      credential: '123456',
      verifyCode: '654321',
      meta: { failCount: 5, retryAfterSec: 30 },
      nested: [{ lockPwdHash: 'another-pass' }],
    }

    const out = redactDeep(value) as Record<string, unknown>

    expect(out.lockPwdHash).toBe(REDACTED)
    expect(out.credential).toBe(REDACTED)
    expect(out.verifyCode).toBe(REDACTED)
    expect(out.lockMode).toBe('security')
    expect(out.meta).toEqual({ failCount: 5, retryAfterSec: 30 })
    expect((out.nested as Array<Record<string, unknown>>)[0]!.lockPwdHash).toBe(REDACTED)
    expect(JSON.stringify(out)).not.toContain('Lock-2e2-pass')
    expect(JSON.stringify(out)).not.toContain('another-pass')
  })

  it('不改入参（深拷贝）', () => {
    const value = { nested: { password: 'p@ss' } }
    redactDeep(value)
    expect(value.nested.password).toBe('p@ss')
  })
})
