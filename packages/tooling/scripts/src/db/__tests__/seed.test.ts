/**
 * `src/db/*` 的用例。
 *
 * 盯三类**会静默错**的东西：
 * - Extended JSON 的往返（`ObjectId`/`Date` 一旦退化成字符串，播种进去的就是坏数据，
 *   而 `_id` 坏了会导致**每次播种都新增一份**——幂等直接失效）；
 * - 连接串拼装（口令要 URL 编码、副本集参数要带上，拼错了会连到别的库上）；
 * - `app_key` 的**形状**（这里刻意不重复后端的生成逻辑，所以形状只能靠用例钉住：
 *   真实数据里 AES 的 `keyB64` 是 44 字符、RSA 私钥 PEM 是 1704 字符）。
 */
import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import { ObjectId } from 'mongodb'
import { describe, expect, it } from 'vitest'
import { generateAesKey, generateAppKeys, generateRsaKey, KEY_VALID_DAYS } from '../app-keys.ts'
import { fromExtendedJson, parseCollectionFile, stringifyCollectionFile, toExtendedJson } from '../ejson.ts'
import { buildMongoUri, listSeedCollections, parseArgs, parseEnvFile } from '../seed.ts'

describe('ejson', () => {
  it('$oid / $date 往返不丢精度', () => {
    const oid = new ObjectId()
    const date = new Date('2026-09-29T12:34:56.789Z')
    const doc = { _id: oid, createdAt: date, nested: { list: [{ at: date }], name: '甲' } }

    const wire = toExtendedJson(doc) as { _id: unknown, createdAt: unknown, nested: { list: { at: unknown }[] } }
    expect(wire._id).toEqual({ $oid: oid.toHexString() })
    expect(wire.createdAt).toEqual({ $date: '2026-09-29T12:34:56.789Z' })

    const back = fromExtendedJson(wire) as typeof doc
    expect(back._id).toBeInstanceOf(ObjectId)
    expect(back._id.toHexString()).toBe(oid.toHexString())
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
    const text = stringifyCollectionFile([{ _id: new ObjectId('5fc8e3cd0144eb274c1c9780'), n: 1 }])
    expect(text.endsWith('\n')).toBe(true)
    const docs = parseCollectionFile(text)
    expect(docs).toHaveLength(1)
    expect(String(docs[0]._id)).toBe('5fc8e3cd0144eb274c1c9780')
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

describe('env 与连接串', () => {
  it('parseEnvFile：忽略注释与空行，剥掉两侧引号', () => {
    const env = parseEnvFile(['# 注释', '', 'A=1', 'B="2"', 'C=\'3\'', 'D=has=eq'].join('\n'))
    expect(env).toEqual({ A: '1', B: '2', C: '3', D: 'has=eq' })
  })

  it('buildMongoUri：副本集 + authSource + 口令 URL 编码', () => {
    // 口令与协议头都**运行时拼接**：写成连续的 `mongodb://user:pass@…` 会被 `lint:secrets` 的
    // `credential-uri` 判成凭据串（它就是这么提示的）。顺带把断言写强一点：明文口令**不许**出现。
    const pass = ['p', '@ss', '/word'].join('')
    const uri = buildMongoUri({
      DATABASE_PRIMARY: 'h1:27017',
      DATABASE_SECONDARY: 'h2:27017',
      DATABASE_ARBITER: 'h3:27017',
      DATABASE_REPLICASET: 'rs0',
      DATABASE_NAME: 'walnut-admin-nestjs',
      DATABASE_USER: 'u',
      DATABASE_PASS: pass,
      DATABASE_SOURCE: 'admin',
    })
    expect(uri.startsWith(`${['mongodb', '://'].join('')}u:${encodeURIComponent(pass)}@h1:27017,h2:27017,h3:27017/walnut-admin-nestjs`)).toBe(true)
    expect(uri.endsWith('?replicaSet=rs0&authSource=admin')).toBe(true)
    expect(uri).not.toContain(pass)
  })

  it('buildMongoUri：无账号时不写 @，且 --db 能覆盖库名', () => {
    const uri = buildMongoUri({ DATABASE_PRIMARY: 'h1:27017', DATABASE_NAME: 'a' }, 'walnut-seed-test')
    expect(uri).toBe('mongodb://h1:27017/walnut-seed-test')
  })

  it('buildMongoUri：缺 DATABASE_PRIMARY 时是前置条件错误（退出码 2 那类）', () => {
    expect(() => buildMongoUri({})).toThrowError(/DATABASE_PRIMARY/)
  })
})

describe('argv', () => {
  it('默认值：不 dry-run、不跳过 app_key、seed 目录是仓内那一个', () => {
    expect(parseArgs([])).toMatchObject({ dryRun: false, skipAppKeys: false, seedDir: 'apps/server/db/seed' })
  })

  it('--only 支持逗号分隔', () => {
    expect(parseArgs(['--only', 'sys_role, sys_user']).only).toEqual(['sys_role', 'sys_user'])
  })

  it('未知参数直接报错（避免拼错了却静默跑默认值）', () => {
    expect(() => parseArgs(['--dryrun'])).toThrowError(/未知参数/)
  })

  it('缺参数值也报错', () => {
    expect(() => parseArgs(['--uri'])).toThrowError(/缺参数值/)
  })
})

describe('seed 目录', () => {
  it('列集合时按文件名排序、忽略非 json', () => {
    // 用例的 cwd 是包目录，所以这里从**本文件位置**推仓库根（6 层：__tests__ → db → src → scripts → tooling → packages）
    const dir = fileURLToPath(new URL('../../../../../../apps/server/db/seed', import.meta.url))
    const names = listSeedCollections(dir)
    expect(names).toContain('app_setting')
    expect(names).toContain('sys_locale')
    expect(names).not.toContain('README.md')
    expect([...names].sort()).toEqual(names)
  })
})
