import type { Connection } from 'mongoose'
import type { DataSource } from 'typeorm'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import process from 'node:process'

import { Types } from 'mongoose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createIntegrationApp, getWalnutConnection, getWalnutPgDataSource } from './helpers/create-integration-app'
import { INTEGRATION_DATABASE_NAME } from './helpers/integration.const'

/**
 * B5 defaultRole 订正脚本 E2E（phase3-plan §5 残留窗口 2）：
 *
 * 在集成 PG 库造 `app_setting(setting_key='app.default.role', value=<hex>)` 行、
 * 在集成 Mongo 库造对应 sys_role 存量角色，然后**实跑脚本**（子进程 node + 原生类型
 * 剥离，与 bin 完全同一路径），断言：
 * 1. hex → uuid v5 重写正确（期望值由本文件内的 RFC 4122 §4.3 参考实现独立求值 ——
 *    与工具链实现互为对拍）；
 * 2. 幂等重跑：值已是 uuid 时 no-op（exit 0，值不变）；
 * 3. 脏值（既非 uuid 也非 hex）拒绝改写（exit 1，值不变），还原 hex 后可再次订正。
 */

/** 工具链 WALNUT_ADMIN_ETL_NAMESPACE 的字面量钉值（uuid5.ts 同源；改动须两处同步） */
const WALNUT_ADMIN_ETL_NAMESPACE = 'c1882c14-e4d4-4f2b-b728-346db51c312e'

const SETTING_KEY = 'app.default.role'
const ENV_FILE = resolve(process.cwd(), 'env-local', '.env.development')
// 实跑 bin（bin = `runCli(main)` 的唯一执行体；src 只导出函数）
const SCRIPT = resolve(process.cwd(), '../../packages/tooling/scripts/bin/fix-setting-default-role.ts')

/** Mongo 侧存量角色 hex（uuid 字符集恰好满足 24 位 [0-9a-f]） */
const roleHex = randomUUID().replaceAll('-', '').slice(0, 24)

/** RFC 4122 §4.3 参考实现（与 @walnut/scripts uuid5.ts 互为对拍的独立实现） */
function uuidV5Reference(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replaceAll('-', ''), 'hex')
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest()
  const bytes = Buffer.from(hash.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0F) | 0x50
  bytes[8] = (bytes[8] & 0x3F) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

describe('B5 fix-setting-default-role (real PG + Mongo, spawned script)', () => {
  let app: Awaited<ReturnType<typeof createIntegrationApp>>
  let pgDataSource: DataSource
  let mongoConnection: Connection

  /** 脚本面向集成库的 argv（env 文件给连接要素，两个库名显式钉到集成库） */
  function scriptArgs(extra: string[] = []): string[] {
    return [SCRIPT, '--env-file', ENV_FILE, '--pg-db', INTEGRATION_DATABASE_NAME, '--db', INTEGRATION_DATABASE_NAME, ...extra]
  }

  async function readSettingValue(): Promise<string | undefined> {
    const rows = await pgDataSource.query<Array<{ setting_value: string }>>(
      'SELECT setting_value FROM app_setting WHERE setting_key = $1',
      [SETTING_KEY],
    )
    return rows[0]?.setting_value
  }

  async function writeSettingValue(value: string): Promise<void> {
    await pgDataSource.query(
      'UPDATE app_setting SET setting_value = $1 WHERE setting_key = $2',
      [value, SETTING_KEY],
    )
  }

  beforeAll(async () => {
    expect(existsSync(ENV_FILE)).toBe(true)
    expect(isAbsolute(SCRIPT)).toBe(true)

    app = await createIntegrationApp()
    pgDataSource = getWalnutPgDataSource(app)
    mongoConnection = getWalnutConnection(app)

    // Mongo 存量角色（脚本的白名单源）+ PG setting 行（value = hex）
    await mongoConnection.db!.collection('sys_role').insertOne({
      _id: new Types.ObjectId(roleHex),
      roleName: 'b5-fix-default-role',
      description: 'B5 订正脚本集成用例',
      menus: [],
      status: true,
    })

    await pgDataSource.query(
      'INSERT INTO app_setting (setting_name, setting_key, setting_value, setting_type) VALUES ($1, $2, $3, $4)',
      ['B5 fix-default-role', SETTING_KEY, roleHex, 'functional'],
    )
  })

  afterAll(async () => {
    await pgDataSource.query('DELETE FROM app_setting WHERE setting_key = $1', [SETTING_KEY])
    await mongoConnection.db!.collection('sys_role').deleteOne({ _id: new Types.ObjectId(roleHex) })
    await app.close()
  })

  it('hex → uuid v5：重写正确，且与 RFC 4122 参考实现一致', async () => {
    const expected = uuidV5Reference(roleHex, WALNUT_ADMIN_ETL_NAMESPACE)

    const run = spawnSync(process.execPath, scriptArgs(), { encoding: 'utf8' })
    expect(run.status).toBe(0)

    const value = await readSettingValue()
    expect(value).toBe(expected)
    // uuid v5 形态：version 位 5
    expect(value![14]).toBe('5')
  })

  it('幂等重跑：值已是 uuid 时 no-op（exit 0，值不变）', async () => {
    const before = await readSettingValue()

    const run = spawnSync(process.execPath, scriptArgs(), { encoding: 'utf8' })
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('已是 uuid')

    expect(await readSettingValue()).toBe(before)
  })

  it('脏值拒绝改写：既非 uuid 也非 hex 时 exit 1 且值不变', async () => {
    await writeSettingValue('role-visitor-not-hex')

    const run = spawnSync(process.execPath, scriptArgs(), { encoding: 'utf8' })
    expect(run.status).toBe(1)
    expect(await readSettingValue()).toBe('role-visitor-not-hex')

    // 还原成 hex：脚本应能再次订正（重跑安全的完整闭环）
    await writeSettingValue(roleHex)
    const rerun = spawnSync(process.execPath, scriptArgs(), { encoding: 'utf8' })
    expect(rerun.status).toBe(0)
    expect(await readSettingValue()).toBe(uuidV5Reference(roleHex, WALNUT_ADMIN_ETL_NAMESPACE))
  })
})
