import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as process from 'node:process'
import { AppLoggerService } from '@walnut-server/app-domain'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * B 段：`app/logger` —— `POST /app/logger/list`（文件名/类型过滤 + 分页）+
 * `GET /app/logger/:logType/:fileName?page=`（按页读行，30 行/页，支持 .gz）。
 *
 * service 以 `process.cwd()/logs` 为根（集成轮 cwd = apps/server）。日志文件自建自清：
 * 本轮写 `logs/application|error/api-spec-<seed>.log` 两个真实文件，list 按 seed 过滤
 * 必然命中；afterEach/afterAll 删除。「无命中」用 list 查不存在的文件名断言空结果，
 * 「读不存在文件」断言受控 50000（ENOENT → 兜底错误通道），不依赖现场有无历史日志。
 */

interface LoggerListData {
  data: Array<{ fileName: string, filePath: string, logType: string, fileSize: string }>
  total: number
}

interface LoggerReadData {
  fileName: string
  filePath: string
  fileContent: string[]
}

describe('B 段：app/logger list + 文件读取（真实 HTTP 全链 + 真实日志文件）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  const fileName = `api-spec-${seed8}.log`
  /** 与 service 同根：process.cwd()/logs */
  const logRoot = path.join(process.cwd(), 'logs')
  const appLogPath = path.join(logRoot, 'application', fileName)
  const errLogPath = path.join(logRoot, 'error', fileName)

  let fixture: WalnutRootUserFixture | null = null

  async function seedLogFiles() {
    await fs.mkdir(path.join(logRoot, 'application'), { recursive: true })
    await fs.mkdir(path.join(logRoot, 'error'), { recursive: true })
    await fs.writeFile(appLogPath, `[APISPEC] application line 1 (${seed8})\n[APISPEC] application line 2\n`, 'utf8')
    await fs.writeFile(errLogPath, `[APISPEC] error line 1 (${seed8})\n`, 'utf8')
  }

  async function removeLogFiles() {
    await fs.rm(appLogPath, { force: true })
    await fs.rm(errLogPath, { force: true })
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `logger-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)

    await seedLogFiles()
  })

  afterEach(async () => {
    // read 用例可能复写文件 —— 每例后回到基线两文件（存在与否由用例自理）
    await removeLogFiles()
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await removeLogFiles()
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('list → 按 fileName 过滤命中本轮两个文件（application + error）', async () => {
    await seedLogFiles()

    const res = await api.root('POST', api.apiPath('/app/logger/list'), {
      query: { fileName: seed8 },
      sort: [{ field: 'fileMTime', order: 'descend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(res, 'logger list')

    const list = bodyOf<LoggerListData>(res).data
    expect(list.total).toBe(2)
    const types = list.data.map(i => i.logType).sort()
    expect(types).toEqual(['application', 'error'])
    // fileSize 走 @TransformSizeToKB —— 出参是 'x.xx KB' 字符串（钉现状）
    expect(Number.parseFloat(list.data[0].fileSize)).toBeGreaterThan(0)
  })

  it('list → logType=error 过滤只命中 error 文件；无命中文件名 → 空列表', async () => {
    await seedLogFiles()

    const errOnly = await api.root('POST', api.apiPath('/app/logger/list'), {
      query: { fileName: seed8, logType: 'error' },
      sort: [],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(errOnly, 'logger list error-only')
    const errList = bodyOf<LoggerListData>(errOnly).data
    expect(errList.total).toBe(1)
    expect(errList.data[0].logType).toBe('error')

    const noMatch = await api.root('POST', api.apiPath('/app/logger/list'), {
      query: { fileName: `no-such-log-${seed8}` },
      sort: [],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(noMatch, 'logger list no match')
    const empty = bodyOf<LoggerListData>(noMatch).data
    expect(empty.total).toBe(0)
    expect(empty.data).toEqual([])
  })

  it('read → 第 1 页命中写入行，filePath 按 logType 拼接', async () => {
    await seedLogFiles()

    const res = await api.root('GET', api.apiPath(`/app/logger/application/${fileName}?page=1`))
    expectOk(res, 'logger read page 1')

    const data = bodyOf<LoggerReadData>(res).data
    expect(data.fileName).toBe(fileName)
    expect(data.filePath).toBe(`application/${fileName}`)
    expect(data.fileContent).toHaveLength(2)
    expect(data.fileContent[0]).toContain(seed8)
  })

  it('read → 越界页返回空内容（30 行/页）', async () => {
    await seedLogFiles()

    const res = await api.root('GET', api.apiPath(`/app/logger/application/${fileName}?page=99`))
    expectOk(res, 'logger read page 99')
    expect(bodyOf<LoggerReadData>(res).data.fileContent).toEqual([])
  })

  it('read → 不存在的文件 → 受控 50000（ENOENT 走兜底错误通道）', async () => {
    const res = await api.root('GET', api.apiPath(`/app/logger/application/no-such-${seed8}.log?page=1`))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR)
  })

  it('read → logType 枚举外 → 受控 40099（ParamEnum 管道闸）', async () => {
    const res = await api.root('GET', api.apiPath(`/app/logger/no-such-type/${fileName}?page=1`))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })

  it('read → fileName 路径穿越 payload（..%2F 打到 logs 目录外）→ 受控 40099（白名单管道第一道闸）', async () => {
    const res = await api.root('GET', api.apiPath('/app/logger/application/..%2F..%2F..%2Fpackage.json?page=1'))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })

  it('service 层纵深：read 直接喂越界 filePath → 受控 400（resolve 包含性断言，修复前是裸 ENOENT/任意文件读）', async () => {
    const service = app.get(AppLoggerService)

    // 管道被绕过（内部调用方）时第二道闸兜底：越出 logs 根即受控异常，而非读任意文件
    await expect(service.read('../package.json', 1)).rejects.toThrowError(WalnutAdminExceptionBadRequest)
    await expect(service.read('application/../../../../package.json', 1)).rejects.toThrowError(WalnutAdminExceptionBadRequest)
    // 合法路径不受影响
    await seedLogFiles()
    const ok = await service.read(`application/${fileName}`, 1)
    expect(ok.fileName).toBe(fileName)
  })

  it('未登录 list → 40101', async () => {
    const res = await api.anon('POST', api.apiPath('/app/logger/list'), {
      query: {},
      sort: [],
      page: { page: 1, pageSize: 10 },
    })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
  })
})
