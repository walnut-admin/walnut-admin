/**
 * `src/db/*` 的用例（Phase 5a：Mongo 版 seed/export/ETL 通道已退役，PG 通道接管）。
 *
 * 盯三类**会静默错**的东西：
 * - Extended JSON 的往返（`$date` 一旦退化成字符串，播种进去的就是坏数据；`$oid` 解析为
 *   24 位 hex 字符串，uuid v5 派生直接吃 hex —— 形状变化由这里钉住）；
 * - env 解析与路径解析（`resolvePath` 的绝对/相对判定错了会写出 `D:\repo\C:\…` 这种怪物）；
 * - `app_key` 的**形状**（这里刻意不重复后端的生成逻辑，所以形状只能靠用例钉住：
 *   真实数据里 AES 的 `keyB64` 是 44 字符、RSA 私钥 PEM 是 1704 字符）。
 */
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import path, { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { server } from '@serenity-kit/opaque'
import { describe, expect, it } from 'vitest'
import { buildPasswordIdentity, verifyPasswordIdentity } from '../admin-credential.ts'
import { generateAesKey, generateAppKeys, generateRsaKey, KEY_VALID_DAYS } from '../app-keys.ts'
import { fromExtendedJson, parseCollectionFile, stringifyCollectionFile, toExtendedJson } from '../ejson.ts'
import { applyPolicy } from '../policy.ts'
import { listSeedCollections, parseEnvFile, resolvePath } from '../seed.ts'

describe('ejson', () => {
  it('$oid / $date 往返不丢精度（$oid → 24 位 hex 字符串，Phase 5a 起无 ObjectId 实例）', () => {
    const hex = '5fc8e3cd0144eb274c1c9780'
    const date = new Date('2026-09-29T12:34:56.789Z')
    const doc = { _id: hex, createdAt: date, nested: { list: [{ at: date }], name: '甲' } }

    const wire = toExtendedJson(doc) as { _id: unknown, createdAt: unknown, nested: { list: { at: unknown }[] } }
    expect(wire._id).toBe(hex)
    expect(wire.createdAt).toEqual({ $date: '2026-09-29T12:34:56.789Z' })

    const back = fromExtendedJson(wire) as typeof doc
    expect(back._id).toBe(hex)
    expect(back.createdAt).toBeInstanceOf(Date)
    expect(back.createdAt.getTime()).toBe(date.getTime())
    expect(back.nested.list[0].at.getTime()).toBe(date.getTime())
  })

  it('只认恰好一个键的包装对象 —— 普通对象里出现 $oid 字样不该被转', () => {
    // 这是刻意的保守：形状判定放宽会把"看起来像 Extended JSON 的普通数据"误转
    const doc = { $oid: 'abc', other: 1 }
    expect(fromExtendedJson(doc)).toEqual(doc)
  })

  it('集合文件往返：解析后是可用的文档数组', () => {
    const text = stringifyCollectionFile([{ _id: '5fc8e3cd0144eb274c1c9780', n: 1 }])
    expect(text.endsWith('\n')).toBe(true)
    const docs = parseCollectionFile(text)
    expect(docs).toHaveLength(1)
    expect(String(docs[0]._id)).toBe('5fc8e3cd0144eb274c1c9780')
  })

  it('仓内 seed **不再是** Extended JSON：解析出来没有 _id / $date（真源已换成 PG 行形态）', () => {
    // 用例的 cwd 是包目录，所以这里从**本文件位置**推仓库根（6 层：__tests__ → db → src → scripts → tooling → packages）
    const seedDir = fileURLToPath(new URL('../../../../../../apps/server/db/seed', import.meta.url))
    const docs = parseCollectionFile(readSysRoleFile(seedDir))
    expect(docs.length).toBeGreaterThan(0)
    expect(docs[0]._id).toBeUndefined()
    expect(docs[0].id).toEqual(expect.any(String))
  })

  it('集合文件不是数组时明确报错（而不是静默当成空）', () => {
    expect(() => parseCollectionFile('{"a":1}')).toThrowError(/数组/)
  })
})

describe('app_key 形状', () => {
  const now = new Date('2026-09-29T00:00:00.000Z')

  it('生成的 aes 密钥：keyB64 是 32 字节 base64（44 字符），bits/cipher 与真实数据一致', () => {
    const doc = generateAesKey(now)
    expect(doc.type).toBe('AES_KEY_URL')
    expect(doc.key.startsWith('aes_key_url-')).toBe(true)
    expect(doc.meta).toMatchObject({ bits: 256, cipher: 'AES-256-GCM' })
    expect(Buffer.from(doc.meta.keyB64 as string, 'base64')).toHaveLength(32)
    expect((doc.meta.keyB64 as string)).toHaveLength(44)
    expect(doc.status).toBe('ACTIVE')
  })

  it('生成的 rsa 密钥：2048 位 SPKI 公钥 + PKCS#8 私钥，有效期与真实数据同为 30 天', () => {
    const doc = generateRsaKey(now)
    expect(doc.type).toBe('RSA_PAIR')
    expect(doc.key.startsWith('rsa_pair-')).toBe(true)
    expect(doc.meta).toMatchObject({ bits: 2048, cipher: 'AES-256-GCM' })
    // PEM 头**运行时拼接**：仓里的 `lint:secrets` 把连续的 PEM 字面量当凭据形状（它的提示就写着
    // 「测试夹具请运行时拼接，别写成连续字面量」）—— 这里照办，别改回字面量。
    const pub = ['-----BEGIN', 'PUBLIC KEY-----'].join(' ')
    const priv = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ')
    expect(String(doc.meta.publicKeyPem).startsWith(pub)).toBe(true)
    expect(String(doc.meta.privateKeyPem).startsWith(priv)).toBe(true)
    expect(doc.validEnd.getTime() - doc.validStart.getTime()).toBe(KEY_VALID_DAYS * 24 * 60 * 60 * 1000)
  })

  it('一套 = AES + RSA 各一条，且两次生成的密钥不同', () => {
    const keys = generateAppKeys(now)
    expect(keys.map(k => k.type)).toEqual(['AES_KEY_URL', 'RSA_PAIR'])
    expect(keys[0].meta.keyB64).not.toBe(generateAesKey(now).meta.keyB64)
  })
})

describe('env 与路径解析', () => {
  it('parseEnvFile：忽略注释与空行，剥掉两侧引号', () => {
    const env = parseEnvFile(['# 注释', '', 'A=1', 'B="2"', 'C=\'3\'', 'D=has=eq'].join('\n'))
    expect(env).toEqual({ A: '1', B: '2', C: '3', D: 'has=eq' })
  })

  it('相对路径按仓库根解，绝对路径原样（否则会拼出 D:\\repo\\C:\\Users\\… 这种怪物）', () => {
    expect(resolvePath('D:/repo', 'apps/server/db/seed')).toBe(join('D:/repo', 'apps/server/db/seed'))
    // 注入平台判定：绝对路径的语义是平台相关的（`C:/tmp` 在 Linux 上不是绝对路径），直接拿宿主的
    // `isAbsolute` 测会在 CI 的 Linux 上得到相反结论（实测就是这么红的）。
    const winAbs = (p: string): boolean => path.win32.isAbsolute(p)
    const posixAbs = (p: string): boolean => path.posix.isAbsolute(p)
    expect(resolvePath('D:/repo', 'C:/tmp/out', winAbs)).toBe('C:/tmp/out')
    expect(resolvePath('/repo', '/tmp/out', posixAbs)).toBe('/tmp/out')
    // 宿主自己的语义也照样成立（真实调用路径）
    expect(resolvePath('D:/repo', resolve('/tmp/out'))).toBe(resolve('/tmp/out'))
  })
})

describe('裁剪策略（两个方向共用一份，两种形态都认）', () => {
  it('行形态（现真源）：按 user_name 裁，头像外链置空', () => {
    const rows = [
      { user_name: 'visitor', avatar: 'https://cdn.example.com/a.png' },
      { user_name: 'tron97', avatar: 'https://cdn.example.com/b.png' },
      { user_name: 'admin', avatar: null },
    ]
    const out = applyPolicy('sys_user', rows)
    expect(out.map(d => d.user_name)).toEqual(['visitor', 'admin'])
    expect(out.every(d => d.avatar === null)).toBe(true)
  })

  it('文档形态（历史导出）：按 userName 裁，头像外链置空', () => {
    const docs = [
      { userName: 'visitor', avatar: 'https://cdn.example.com/a.png' },
      { userName: 'tron97', avatar: 'https://cdn.example.com/b.png' },
      { userName: 'admin', avatar: null },
    ]
    const out = applyPolicy('sys_user', docs)
    expect(out.map(d => d.userName)).toEqual(['visitor', 'admin'])
    expect(out.every(d => d.avatar === null)).toBe(true)
    // 原数组不该被就地改动（导出时还要拿它做别的）
    expect(docs[0].avatar).toBe('https://cdn.example.com/a.png')
  })

  it('没有策略的集合原样返回（且是副本）', () => {
    const docs = [{ _id: 1 }]
    const out = applyPolicy('sys_role', docs)
    expect(out).toEqual(docs)
    expect(out).not.toBe(docs)
  })
})

describe('口令凭证（OPAQUE 注册 + 登录验证）', () => {
  // 用**真实**的 OPAQUE 协议在进程内跑：注册 → 入库形状 → 用同一套 serverSetup 验证登录握手。
  // 这条用例是"播种后能登录"的最小判据（不需要起后端与 HTTP）。
  const serverSetup = server.createSetup()

  it('注册记录的形状与服务端 finishRegister 一致（value 与 valueHash 都放记录本身）', () => {
    const identity = buildPasswordIdentity('u1', 'visitor', 'pw-123456', serverSetup)
    expect(identity).toMatchObject({
      userId: 'u1',
      type: 'password',
      purpose: 'login',
      maskedValue: '********',
      verified: true,
      isPrimary: true,
      status: true,
      metadata: {},
    })
    expect(identity.value.length).toBeGreaterThan(100)
    expect(identity.valueHash).toBe(identity.value)
    expect(identity.verifiedAt).toBeInstanceOf(Date)
  })

  it('同一份 serverSetup 下能完成完整登录握手（拿到会话密钥）', () => {
    const identity = buildPasswordIdentity('u1', 'visitor', 'pw-123456', serverSetup)
    const proof = verifyPasswordIdentity('visitor', 'pw-123456', identity.value, serverSetup)
    expect(proof.ok).toBe(true)
    expect(proof.sessionKeyLength).toBeGreaterThan(0)
  })

  it('口令不对 ⇒ 握手失败（判据不是"写进去了就算"）', () => {
    const identity = buildPasswordIdentity('u1', 'visitor', 'pw-123456', serverSetup)
    const proof = verifyPasswordIdentity('visitor', 'another-password', identity.value, serverSetup)
    expect(proof.ok).toBe(false)
  })

  it('serverSetup 换一份（等价于换了 AUTH_OPAQUE_SECRET） ⇒ 握手失败', () => {
    // 这条钉住的是"凭证不可跨环境搬运"这个**协议性质**：正因如此，seed 里不能发凭证
    const identity = buildPasswordIdentity('u1', 'visitor', 'pw-123456', serverSetup)
    const proof = verifyPasswordIdentity('visitor', 'pw-123456', identity.value, server.createSetup())
    expect(proof.ok).toBe(false)
  })
})

describe('seed 目录', () => {
  it('列集合时按文件名排序、忽略非 json', () => {
    const dir = fileURLToPath(new URL('../../../../../../apps/server/db/seed', import.meta.url))
    const names = listSeedCollections(dir)
    expect(names).toContain('app_setting')
    expect(names).toContain('sys_locale')
    expect(names).not.toContain('README.md')
    expect([...names].sort()).toEqual(names)
  })
})

/** 读仓内 sys_role.json（文件缺失本身就该红） */
function readSysRoleFile(seedDir: string): string {
  return readFileSync(join(seedDir, 'sys_role.json'), 'utf8')
}
