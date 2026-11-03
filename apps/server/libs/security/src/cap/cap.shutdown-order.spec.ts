import type { OnApplicationShutdown, OnModuleDestroy } from '@nestjs/common'
import process from 'node:process'
import { Injectable } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { AppTechCacheAppSettingsService } from '@walnut-server/cache'
import { AppTechCookieService } from '@walnut-server/cookie'
import { describe, expect, it, vi } from 'vitest'

import { AppCapJS, SecurityCapService } from './cap.service'

/**
 * 「收到 SIGTERM 后，PG 连接池与 Bull 队列都已关闭，进程才退出」的**机械断言**
 * （reports/batch-7/r2-sigterm.md §4）。
 *
 * 这里不 mock Nest —— 跑的是真 `@nestjs/core` 的关闭序列（12.3.2，
 * nest-application-context.js:152-164）：
 *
 * ```text
 * prepareClose → onModuleDestroy → beforeApplicationShutdown → dispose → onApplicationShutdown
 * ```
 *
 * 三个假依赖挂的是**真实实现所在的钩子**：
 * - Redis：AppTechRedisService.onModuleDestroy 里 `client.quit()`（libs/cache/src/redis/redis.service.ts:29）
 * - PG：TypeOrmCoreModule.onApplicationShutdown 里关 DataSource（@nestjs/typeorm/dist/typeorm-core.module.js:120）
 * - Bull：每个 Queue 的 onApplicationShutdown = `queue.close()`（@nestjs/bull/dist/bull.providers.js:33）
 *
 * 所以「cap.cleanup 在 pg / bull 之前」这条断言，等价于「CAP 落盘先于 PG / Bull 排空」。
 */

const events: string[] = []

@Injectable()
class SpecFakeRedis implements OnModuleDestroy {
  async onModuleDestroy() {
    events.push('redis.quit')
  }
}

@Injectable()
class SpecFakePgDataSource implements OnApplicationShutdown {
  async onApplicationShutdown() {
    events.push('pg.dataSource.closed')
  }
}

@Injectable()
class SpecFakeBullQueue implements OnApplicationShutdown {
  async onApplicationShutdown() {
    events.push('bull.queue.closed')
  }
}

describe('关闭顺序：CAP cleanup 必须在 PG / Bull 排空之前', () => {
  it('onModuleDestroy(Redis) → beforeApplicationShutdown(CAP) → onApplicationShutdown(PG / Bull)，全程不 process.exit', async () => {
    events.length = 0

    const cleanupSpy = vi
      .spyOn(AppCapJS, 'cleanup')
      .mockImplementation(async () => {
        events.push('cap.cleanup')
      })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    const moduleRef = await Test.createTestingModule({
      providers: [
        SecurityCapService,
        SpecFakeRedis,
        SpecFakePgDataSource,
        SpecFakeBullQueue,
        { provide: AppTechCacheAppSettingsService, useValue: { getCapJSConfig: vi.fn() } },
        { provide: AppTechCookieService, useValue: { setResponseCookie: vi.fn() } },
      ],
    }).compile()

    try {
      await moduleRef.init()
      await moduleRef.close()
    }
    finally {
      cleanupSpy.mockRestore()
      exitSpy.mockRestore()
    }

    // 四段都在（少一段就说明那条关闭钩子没挂上）
    expect(events).toEqual(expect.arrayContaining(['redis.quit', 'cap.cleanup', 'pg.dataSource.closed', 'bull.queue.closed']))

    // 顺序：Redis 最先（onModuleDestroy 是序列第一段），CAP 落盘在中段，
    // PG / Bull 是 onApplicationShutdown —— 必须排在 CAP 之后
    expect(events.indexOf('cap.cleanup')).toBeGreaterThan(events.indexOf('redis.quit'))
    expect(events.indexOf('pg.dataSource.closed')).toBeGreaterThan(events.indexOf('cap.cleanup'))
    expect(events.indexOf('bull.queue.closed')).toBeGreaterThan(events.indexOf('cap.cleanup'))

    // 关闭序列本身不许调 process.exit：退出由 main.ts 的 useProcessExit 在整段跑完后做
    expect(exitSpy).not.toHaveBeenCalled()
  }, 30_000) // 真起 Nest 应用跑关闭序列：默认 5s 在负载下会假红
})
