import type { CallHandler, ExecutionContext, INestApplication } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { Reflector } from '@nestjs/core'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { ALSRequestService } from '@walnut-server/als'
import { AppTechRedisService } from '@walnut-server/cache'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminConstAppEvent } from '@walnut-server/const/app/event'
import { WalnutAdminConstDecoratorLogAuthType } from '@walnut-server/const/decorator/logAuth'

import { WalnutAdminConstDecoratorLogOperateAction, WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { DBTransactionHooksStore } from '@walnut-server/db'

import { WalnutAdminGuardAuth } from '@walnut-server/guards'

import { SharedIpService } from '@walnut-server/ip'
import { SysDeletedEntity } from '@walnut-server/repository'
import { SysLogAuthEntity, SysLogAuthSharedService, SysLogOperateEntity, SysLogOperateRepoService } from '@walnut-server/system'
import { I18nContext, I18nService } from 'nestjs-i18n'
import { from, lastValueFrom, throwError } from 'rxjs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { WalnutAdminDecoratorAuthLog, WalnutAdminInterceptorRequestAuthLog } from '@/decorators/walnut/log.auth.decorator'
import { WalnutAdminDecoratorOperateLog, WalnutAdminInterceptorRequestOperateLog } from '@/decorators/walnut/log.operate.decorator'
import { createIntegrationApp, getWalnutPgAdminDataSource } from './helpers/create-integration-app'
import { INTEGRATION_DATABASE_NAME } from './helpers/integration.const'

/**
 * B8 —— 日志旁路（fire-and-forget）PG 化的对账基准：
 *
 * - 操作日志 tap 异步写最终落库（轮询等待，不 sleep 硬等），字段逐项对齐
 *   phase2 4.16（jsonb 直写对象 + operation NULL 勘误 + userId uuid 直传）；
 * - request/response 序列化失败 → jsonb 列置空、原文落 raw_* 旁路列（Q7 定案）；
 * - 认证日志 guard 失败触发链路（真实 WalnutAdminGuardAuth.handleRequest →
 *   SysLogAuthSharedService.recordAuth → PG 落库 + failedLogin risk 收集）与
 *   decorator 成功链路（userId uuid 直传 —— :109 ObjectId 点的 B8 裁定）；
 * - logOperateId 回填链路（B9 收口后解锁改写）：真实 EventEmitter2 事件 →
 *   AppTechEventService 监听 → SysDeletedPgRepoService 按 deletedId uuid 直等
 *   更新 sys_deleted（未命中行不抛错、只记日志 —— 旁路吞错语义）。
 *
 * 驱动方式与 pg.transaction.int-spec 同口径：直接实例化真实拦截器/guard
 * （依赖取自全量 AppModule），假 ExecutionContext 驱动 —— 验证本体而非复刻。
 * 故意只用 CREATE/UPDATE action 的拦截器用例（DELETE 事件的回填链路在文末
 * 独立用例以真实事件驱动）。
 */
describe('log bypass (fire-and-forget) on real PG', () => {
  let app: INestApplication
  let pgDataSource: DataSource
  let i18nService: I18nService
  let operateInterceptor: WalnutAdminInterceptorRequestOperateLog
  let authInterceptor: WalnutAdminInterceptorRequestAuthLog

  const runSpec = async (fn: () => Promise<void>) =>
    I18nContext.createAsync(new I18nContext('zh_CN', i18nService), fn)

  function makeOperateContext(request: Record<string, unknown>, handler: () => void): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ statusCode: 200 }),
        getNext: () => undefined,
      }),
      getClass: () => SpecOperateTarget,
      getHandler: () => handler,
    } as unknown as ExecutionContext
  }

  function makeAuthContext(request: Record<string, unknown>, handler: () => void): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ statusCode: 200 }),
        getNext: () => undefined,
      }),
      getClass: () => SpecAuthTarget,
      getHandler: () => handler,
    } as unknown as ExecutionContext
  }

  function makeFakeRequest(overrides: Record<string, unknown> = {}) {
    const deviceId = `spec-device-${randomUUID()}`
    const identifier = `spec-${randomUUID()}@walnut-admin.com`

    return {
      deviceId,
      identifier,
      request: {
        id: randomUUID(),
        realIp: '127.0.0.1',
        method: 'POST',
        url: `/spec/${randomUUID()}`,
        httpVersion: '1.1',
        os: 'spec-os',
        browser: 'spec-browser',
        params: {},
        signedCookies: { [WalnutAdminConstCookieKeys.DEVICE_ID]: deviceId },
        identifier,
        ...overrides,
      } as Record<string, unknown>,
    }
  }

  /** fire-and-forget 的最终一致断言：轮询等待行落库，不 sleep 硬等 */
  async function waitForLogRow<T extends object>(
    entity: new () => T,
    where: Partial<T>,
  ): Promise<T> {
    let row: T | undefined

    await vi.waitFor(
      async () => {
        const rows = await pgDataSource.manager.find(entity, { where: where as never })
        expect(rows.length).toBeGreaterThan(0)
        row = rows[0]
      },
      { timeout: 10_000, interval: 100 },
    )

    return row as T
  }

  beforeAll(async () => {
    app = await createIntegrationApp()
    pgDataSource = getWalnutPgAdminDataSource(app)

    // 守卫自检：PG 指向集成库
    expect(pgDataSource.options.database).toBe(INTEGRATION_DATABASE_NAME)

    i18nService = app.get(I18nService)

    operateInterceptor = new WalnutAdminInterceptorRequestOperateLog(
      app.get(Reflector),
      app.get(SysLogOperateRepoService),
      app.get(EventEmitter2),
      app.get(ALSRequestService),
      app.get(SharedIpService),
    )

    authInterceptor = new WalnutAdminInterceptorRequestAuthLog(
      app.get(SysLogAuthSharedService),
    )
  })

  /** 用例里真实触发的 failedLogin 收集键登记（afterAll 清理） */
  const collectedRiskKeys: string[] = []

  afterAll(async () => {
    // failedLogin risk 的 Redis 收集键（risk:failed_login:<identifier>:<deviceId>）
    // 随用例唯一 identifier/deviceId 生成，这里精确清理
    const redis = app.get(AppTechRedisService).getClient()
    await Promise.all(collectedRiskKeys.map(async key => redis.del(key)))

    await app.close()
  })

  // 真实 decorator（内含 metadata + UseInterceptors 装配）挂在 dummy 类上，
  // 供 reflector 读元数据 —— 与线上 controller 完全同构
  class SpecOperateTarget {
    @WalnutAdminDecoratorOperateLog({
      title: WalnutAdminConstDecoratorLogOperateTitle.APP_DEMO,
      action: WalnutAdminConstDecoratorLogOperateAction.CREATE,
    })
    handleSpecCreate() {}

    @WalnutAdminDecoratorOperateLog({
      title: WalnutAdminConstDecoratorLogOperateTitle.APP_DEMO,
      action: WalnutAdminConstDecoratorLogOperateAction.DELETE,
    })
    handleSpecDelete() {}
  }

  class SpecAuthTarget {
    @WalnutAdminDecoratorAuthLog(WalnutAdminConstDecoratorLogAuthType.OPAQUE)
    handleSpecAuth() {}
  }

  // 元数据载体是方法函数本身（decorator 落在 descriptor.value 上）—— 直取方法引用；
  // 不能 .bind()（会产生新函数、丢掉 reflect metadata），局部豁免 ts/unbound-method
  // eslint-disable-next-line ts/unbound-method
  const specOperateHandler = SpecOperateTarget.prototype.handleSpecCreate
  // eslint-disable-next-line ts/unbound-method
  const specOperateDeleteHandler = SpecOperateTarget.prototype.handleSpecDelete
  // eslint-disable-next-line ts/unbound-method
  const specAuthHandler = SpecAuthTarget.prototype.handleSpecAuth

  it('operate log: tap next 异步写最终落库（jsonb 直写对象 / operation NULL 勘误 / userId uuid 直传）', async () => {
    await runSpec(async () => {
      const userId = randomUUID()
      const { deviceId, request } = makeFakeRequest({
        body: { specKey: randomUUID() },
        user: { userId, userName: 'spec-user' },
      })

      const result$ = operateInterceptor.intercept(
        makeOperateContext(request, specOperateHandler),
        { handle: () => from(Promise.resolve({ spec: 'ok' })) } as CallHandler,
      )
      await lastValueFrom(result$)

      const row = await waitForLogRow(SysLogOperateEntity, { url: request.url as string })

      expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(row.title).toBe(WalnutAdminConstDecoratorLogOperateTitle.APP_DEMO)
      expect(row.actionType).toBe(WalnutAdminConstDecoratorLogOperateAction.CREATE)
      // B8 勘误钉现状：crud 装饰器不传 operateType → operation 落 NULL
      // （migration 已收 NULL，见 phase3-plan §6 B8 追加）
      expect(row.operation).toBeNull()
      expect(row.method).toBe('POST')
      expect(row.httpVersion).toBe('1.1')
      expect(row.statusCode).toBe(200)
      // jsonb 直写对象（不再是 stringify 字符串）
      expect(row.requestData).toEqual(request.body)
      expect(typeof row.requestData).toBe('object')
      // responseData = WalnutAdminResponseSuccess(res, requestId) + msg 译文
      expect(row.responseData).toEqual(
        expect.objectContaining({ data: { spec: 'ok' }, requestId: request.id }),
      )
      expect(typeof row.durationMs).toBe('number')
      // userId 松引用：B7a 起 token 即 PG uuid，直传（Mongo 时代的 ObjectId 包装已摘）
      expect(row.userId).toBe(userId)
      expect(row.userName).toBe('spec-user')
      // deviceId 松引用来自 cookie
      expect(row.deviceId).toBe(deviceId)
      // realIp 127.0.0.1 → getLocationFromBaidu 走 LOCAL 分支（不触外网）
      expect(row.ip).toBe('127.0.0.1')
      expect(row.location).toBe('LOCAL')
      expect(row.os).toBe('spec-os')
      expect(row.browser).toBe('spec-browser')
      expect(row.invokingMethod).toBe('SpecOperateTarget.handleSpecCreate')
      expect(row.success).toBe(true)
      // 正常路径 raw_* 旁路列为 NULL
      expect(row.rawRequestData).toBeNull()
      expect(row.rawResponseData).toBeNull()
      // 快照列：无 ALS store 时为 NULL（与 Mongo 时代 ALS 缺失行为一致）
      expect(row.snapshotBefore).toBeNull()
      expect(row.snapshotAfter).toBeNull()
      expect(row.operatedAt).toBeInstanceOf(Date)
    })
  })

  it('operate log: request 序列化失败 → request_data 置空、原文落 raw_request_data 旁路列', async () => {
    await runSpec(async () => {
      // 循环引用：JSON.stringify 抛 TypeError → 走 raw_* 旁路（零丢失语义）
      const circular: Record<string, unknown> = { specKey: randomUUID() }
      circular.self = circular

      const { request } = makeFakeRequest({ body: circular })

      const result$ = operateInterceptor.intercept(
        makeOperateContext(request, specOperateHandler),
        { handle: () => from(Promise.resolve({ spec: 'ok' })) } as CallHandler,
      )
      await lastValueFrom(result$)

      const row = await waitForLogRow(SysLogOperateEntity, { url: request.url as string })

      expect(row.requestData).toBeNull()
      // 原文尽力文本化：循环引用对象只能 String() 化（log.operate.jsonb.ts 的如实降级）
      expect(row.rawRequestData).toBe(String(circular))
      // response 侧未受牵连：jsonb 正常、raw 为空
      expect(row.responseData).toEqual(expect.objectContaining({ data: { spec: 'ok' } }))
      expect(row.rawResponseData).toBeNull()
    })
  })

  it('operate log: tap error 路径异步写 success=false（吞错不外抛）', async () => {
    await runSpec(async () => {
      const { request } = makeFakeRequest({ body: {} })

      const result$ = operateInterceptor.intercept(
        makeOperateContext(request, specOperateHandler),
        {
          handle: () => throwError(() => new Error('spec operate boom')),
        } as CallHandler,
      )

      await expect(lastValueFrom(result$)).rejects.toThrow('spec operate boom')

      const row = await waitForLogRow(SysLogOperateEntity, { url: request.url as string })

      expect(row.success).toBe(false)
      // 异常响应体（WalnutAdminExceptionHandler 产物）整体进 response_data jsonb
      expect(row.responseData).toEqual(expect.objectContaining({ requestId: request.id }))
      expect(row.statusCode).toBe(200)
    })
  })

  it('auth log: guard 失败触发链路（recordAuth + failedLogin risk 收集，成功字段钉相）', async () => {
    await runSpec(async () => {
      const { deviceId, identifier, request } = makeFakeRequest()

      collectedRiskKeys.push(`risk:failed_login:${identifier}:${deviceId}`)

      const GuardMixin = WalnutAdminGuardAuth('local')
      const guard = new GuardMixin()
      // 属性注入字段手动补（真实依赖来自全量 AppModule，同 pg.transaction int-spec 口径）
      Object.assign(guard, { logAuthSharedService: app.get(SysLogAuthSharedService) })

      // 登录失败：guard 记日志（fire-and-forget）后原样抛错
      expect(() =>
        guard.handleRequest(new Error('spec auth boom'), null, undefined, makeAuthContext(request, specAuthHandler)),
      ).toThrow('spec auth boom')

      const row = await waitForLogRow(SysLogAuthEntity, { identifier })

      // 匿名失败登录：userId NULL（松引用可空）、userName NULL
      expect(row.userId).toBeNull()
      expect(row.userName).toBeNull()
      expect(row.success).toBe(false)
      expect(row.type).toBe(WalnutAdminConstDecoratorLogAuthType.OPAQUE)
      expect(row.deviceId).toBe(deviceId)
      expect(row.ip).toBe('127.0.0.1')
      expect(row.location).toBe('LOCAL')
      expect(row.os).toBe('spec-os')
      expect(row.browser).toBe('spec-browser')
      // msg = errI18nMsg 经 i18n 通道（非翻译键原样返回 —— nestjs-i18n 对缺失键返回 key 本身）
      expect(row.msg).toBe('spec auth boom')
      expect(row.authenticatedAt).toBeInstanceOf(Date)

      // failedLogin risk 收集同链路触发（真实 Redis，键随 afterAll 精确清理）
      const risk = await app.get(AppTechRedisService).getClient().hGetAll(`risk:failed_login:${identifier}:${deviceId}`)
      expect(risk.count).toBe('1')
      expect(risk.identifier).toBe(identifier)
    })
  })

  it('auth log: decorator 成功链路（userId uuid 直传 —— :109 ObjectId 点的 B8 裁定）', async () => {
    await runSpec(async () => {
      const userId = randomUUID()
      const { request } = makeFakeRequest({
        user: { userId, userName: 'spec-auth-user' },
      })

      const result$ = authInterceptor.intercept(
        makeAuthContext(request, specAuthHandler),
        { handle: () => from(Promise.resolve(true)) } as CallHandler,
      )
      await lastValueFrom(result$)

      const row = await waitForLogRow(SysLogAuthEntity, { identifier: request.identifier as string })

      expect(row.success).toBe(true)
      expect(row.userId).toBe(userId)
      expect(row.userName).toBe('spec-auth-user')
      expect(row.type).toBe(WalnutAdminConstDecoratorLogAuthType.OPAQUE)
      expect(row.msg).toBe(String(new I18nContext('zh_CN', i18nService).t('response.20000')))
    })
  })

  it('P2-29：删除回填事件推迟到事务提交后（runAfterCommit 钩子，拦截器 tap 不再立即 emit）', async () => {
    const deletedId = randomUUID()
    /** 拦截器真实落到 sys_log_operate 的行 id（事件 payload 的 logOperateId） */
    let expectedLogOperateId = ''

    await pgDataSource.manager.insert(SysDeletedEntity, {
      id: randomUUID(),
      content: { spec: deletedId },
      modelName: 'SpecModel',
      collectionName: 'spec_collection',
      deletedId,
      deletedBy: randomUUID(),
      logOperateId: null,
      deletedAt: new Date(),
    })

    const hooks: Array<() => Promise<void>> = []

    await DBTransactionHooksStore.run(hooks, async () => {
      await runSpec(async () => {
        const { request } = makeFakeRequest({
          params: { id: deletedId },
          body: {},
        })

        const result$ = operateInterceptor.intercept(
          makeOperateContext(request, specOperateDeleteHandler),
          { handle: () => from(Promise.resolve({ spec: 'ok' })) } as CallHandler,
        )
        await lastValueFrom(result$)

        // 日志行异步落库（fire-and-forget）—— 等它出现，同时等 runAfterCommit 把事件压入钩子队列
        const logRow = await waitForLogRow(SysLogOperateEntity, { url: request.url as string })
        expectedLogOperateId = logRow.id

        await vi.waitFor(() => {
          expect(hooks.length).toBe(1)
        }, { timeout: 10_000, interval: 50 })

        // 事务尚未提交（钩子未执行）：sys_deleted 的 logOperateId 必须仍为 null
        const beforeCommit = await pgDataSource.manager.findOne(SysDeletedEntity, { where: { deletedId } })
        expect(beforeCommit?.logOperateId).toBeNull()
      })
    })

    // 模拟事务拦截器的提交后阶段：执行钩子 → 事件发出 → 监听侧回填
    for (const hook of hooks) {
      await hook()
    }

    await vi.waitFor(
      async () => {
        const row = await pgDataSource.manager.findOne(SysDeletedEntity, { where: { deletedId } })
        expect(row?.logOperateId).toBe(expectedLogOperateId)
      },
      { timeout: 10_000, interval: 100 },
    )
  })

  it('P2-29：已有 logOperateId 的历史快照不被新日志覆盖', async () => {
    const deletedId = randomUUID()
    const historicalLogOperateId = randomUUID()
    const latestLogOperateId = randomUUID()

    // 历史快照（已关联日志）+ 当前快照（未关联）—— 同一被删行的两次软删
    await pgDataSource.manager.insert(SysDeletedEntity, {
      id: randomUUID(),
      content: { spec: deletedId },
      modelName: 'SpecModel',
      collectionName: 'spec_collection',
      deletedId,
      deletedBy: randomUUID(),
      logOperateId: historicalLogOperateId,
      deletedAt: new Date(Date.now() - 60_000),
    })
    await pgDataSource.manager.insert(SysDeletedEntity, {
      id: randomUUID(),
      content: { spec: deletedId },
      modelName: 'SpecModel',
      collectionName: 'spec_collection',
      deletedId,
      deletedBy: randomUUID(),
      logOperateId: null,
      deletedAt: new Date(),
    })

    app.get(EventEmitter2).emit(WalnutAdminConstAppEvent.LOG_OPERATE_DELETE, { logOperateId: latestLogOperateId, deletedId })

    await vi.waitFor(
      async () => {
        const rows = await pgDataSource.manager.find(SysDeletedEntity, { where: { deletedId }, order: { deletedAt: 'ASC' } })
        expect(rows).toHaveLength(2)
        expect(rows[0].logOperateId).toBe(historicalLogOperateId)
        expect(rows[1].logOperateId).toBe(latestLogOperateId)
      },
      { timeout: 10_000, interval: 100 },
    )
  })

  it('logOperateId 回填：真实事件链路 —— LOG_OPERATE_DELETE 按 deletedId uuid 直等更新 sys_deleted', async () => {
    const deletedId = randomUUID()
    const logOperateId = randomUUID()

    await pgDataSource.manager.insert(SysDeletedEntity, {
      id: randomUUID(),
      content: { spec: deletedId },
      modelName: 'SpecModel',
      collectionName: 'spec_collection',
      deletedId,
      deletedBy: randomUUID(),
      logOperateId: null,
      deletedAt: new Date(),
    })

    // 真实 EventEmitter2 → AppTechEventService（@OnEvent 监听侧，与线上一致）
    app.get(EventEmitter2).emit(WalnutAdminConstAppEvent.LOG_OPERATE_DELETE, { logOperateId, deletedId })

    await vi.waitFor(
      async () => {
        const row = await pgDataSource.manager.findOne(SysDeletedEntity, { where: { deletedId } })
        expect(row?.logOperateId).toBe(logOperateId)
      },
      { timeout: 10_000, interval: 100 },
    )
  })

  it('logOperateId 回填：LOG_OPERATE_DELETE_MANY 按 idSeparator 拆分逐个回填', async () => {
    const deletedIds = [randomUUID(), randomUUID()]
    const logOperateId = randomUUID()

    for (const deletedId of deletedIds) {
      await pgDataSource.manager.insert(SysDeletedEntity, {
        id: randomUUID(),
        content: { spec: deletedId },
        modelName: 'SpecModel',
        collectionName: 'spec_collection',
        deletedId,
        deletedBy: randomUUID(),
        logOperateId: null,
        deletedAt: new Date(),
      })
    }

    app.get(EventEmitter2).emit(WalnutAdminConstAppEvent.LOG_OPERATE_DELETE_MANY, {
      logOperateId,
      deletedIds: deletedIds.join(','),
    })

    await vi.waitFor(
      async () => {
        const rows = await pgDataSource.manager.find(SysDeletedEntity, { where: { deletedId: deletedIds[0] } })
        expect(rows[0]?.logOperateId).toBe(logOperateId)

        const rows2 = await pgDataSource.manager.find(SysDeletedEntity, { where: { deletedId: deletedIds[1] } })
        expect(rows2[0]?.logOperateId).toBe(logOperateId)
      },
      { timeout: 10_000, interval: 100 },
    )
  })

  it('logOperateId 回填：deletedId 未命中 → 不抛错只记日志（旁路吞错语义）', async () => {
    // 未命中任何行（update affected 0 → 返回 null），事件监听侧不得外抛；
    // emitAsync 以监听器返回值数组 resolve，这里只钉「不 reject」
    await expect(app.get(EventEmitter2).emitAsync(WalnutAdminConstAppEvent.LOG_OPERATE_DELETE, {
      logOperateId: randomUUID(),
      deletedId: randomUUID(),
    })).resolves.toBeDefined()
  })
})
