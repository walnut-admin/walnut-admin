import type { IWalnutAdminDataScopeDescriptor, IWalnutAdminDataScopeRlsSettings } from '@walnut-server/db'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstDataScopeMode } from '@walnut-server/const/app/dataScope'

interface RequestContext {
  snapshotBefore?: Record<string, any>
  snapshotAfter?: Record<string, any>
  authIdtifier?: string
  /** 当前请求用户（数据权限 SELF 的 owner 取值） */
  userId?: string
  /**
   * 数据权限描述符（ALSRequestInterceptor 在请求进入 handler 前种入）。
   * 缺失 = 没有可用的数据权限上下文；基类对已注册实体 fail-closed（抛错）。
   */
  dataScope?: IWalnutAdminDataScopeDescriptor
  /**
   * 事务级 RLS 设置（ALSRequestInterceptor 按同一份描述符 + 账号部门计算）。
   * 基类自动事务直接使用它，保证 `request.dataScopeRls`（@WalnutTx 通道）与
   * 自动事务写出的 GUC 完全一致。
   */
  rlsSettings?: IWalnutAdminDataScopeRlsSettings
  /** 系统通道标记（runAsSystem；仅用于调试/审计，不影响谓词） */
  systemTask?: boolean
}

@Injectable()
export class ALSRequestService {
  private readonly als = new AsyncLocalStorage<RequestContext>()
  private readonly logger = new Logger(ALSRequestService.name)

  run<T>(callback: () => T): T {
    const result = this.als.run({}, callback)
    return result
  }

  /**
   * 系统通道：显式以 ALL 范围进入 ALS，供 cron / 脚本 / 测试等非 HTTP 入口使用
   * （docs/plans/data-scope-design.md §7「显式 bypass + 审计」）。
   *
   * 只用于**确实没有请求用户**的内部任务；请求处理路径不允许调用（那会绕过
   * fail-closed 语义）。使用点应能说清「为什么这个任务需要跨用户读」。
   */
  runAsSystem<T>(callback: () => T): T {
    return this.als.run({
      dataScope: { mode: WalnutAdminConstDataScopeMode.ALL },
      systemTask: true,
    }, callback)
  }

  /** 当前异步链路上是否有 ALS store（区分「请求内缺上下文」与「非请求通道」） */
  hasActiveContext(): boolean {
    return this.als.getStore() !== undefined
  }

  set<K extends keyof RequestContext>(key: K, value: RequestContext[K]) {
    const store = this.als.getStore()
    this.logger.debug(`Setting ${key}, store exists: ${!!store}`)

    if (store) {
      store[key] = value
      this.logger.debug(`${key} after set: ${JSON.stringify(store[key])}`)
    }
    else {
      this.logger.warn(`No ALS store found when setting ${key}. This means ALS scope is not active.`)
    }
  }

  get<K extends keyof RequestContext>(key: K): RequestContext[K] | undefined {
    const store = this.als.getStore()
    this.logger.debug(`Getting ${key}, store exists: ${!!store}`)

    if (store) {
      const value = store[key]
      this.logger.debug(`${key} value: ${JSON.stringify(value)}`)
      return value
    }

    this.logger.warn(`No ALS store found when getting ${key}.`)
    return undefined
  }
}
