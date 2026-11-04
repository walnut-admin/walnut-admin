import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { importClosure, SERVER_ROOT, shortestChain, specifiersOf } from '../module-graph'

/**
 * G1 —— worker 进程的**静态 import 闭包**不得含 CAP 求值链 / Throttler 注册 / Socket gateway。
 *
 * 背景（reports/batch-6/r1-http-split.md §2.3 / H2）：模块图切分**不够**。CAP 的真实入口不是
 * DI 链，而是**模块求值链**
 *
 *   worker/main.ts -> worker.module.ts -> app.module.ts -> @walnut-server/guards(barrel)
 *                  -> guards/cap.guard.ts -> security/cap/cap.service.ts -> new Cap()
 *
 * new Cap() 在**模块求值期**就建 .data/tokensList.json 并注册 SIGTERM 处理器（R1 §2.4 实测：
 * SIGTERM listeners 0 -> 1、目录 + 文件被创建、内容 "{}"）。所以判据必须是**文件级闭包**，
 * 而不是「DI 图里有没有 SecurityCapService」—— 后者在阶段 1 就能满足，但 .data 写回与
 * SIGTERM 竞争都还在（这正是拍板 D2 取「模块求值级」的理由）。
 *
 * 判据口径：从 apps/worker/src/main.ts 出发，按 tsconfig 的 paths 解析每条 import/export/require，
 * 得到「运行期会被 require 到」的 .ts 集合。别名解析与 module-graph.ts 共用同一实现，
 * 保证与 tsc / SWC 的看法一致。
 */

const WORKER_ENTRY = 'apps/worker/src/main.ts'
const workerClosure = importClosure(WORKER_ENTRY)

/** 断言「不在闭包里」，失败时把最短链打出来 */
function expectOutside(file: string): void {
  const chain = shortestChain(workerClosure, WORKER_ENTRY, file)
  expect(
    chain,
    `${file} 不应出现在 worker 闭包里，实际链：${String(chain && chain.join(' -> '))}`,
  ).toBeNull()
}

describe('g1 · worker import 闭包（模块求值级隔离）', () => {
  it('走查器有牙：api 侧同一走查器必须命中 CAP 求值链（反证，防止闭包被走成空集）', () => {
    // 用 app.module.ts 当 api 侧入口：它 import 的东西 = api 运行期要 require 的东西
    const apiClosure = importClosure('apps/api/src/app/app.module.ts')
    expect(apiClosure.files.size).toBeGreaterThan(500)
    expect(apiClosure.files.has('libs/security/src/cap/cap.service.ts')).toBe(true)
    expect(apiClosure.files.has('apps/api/src/socket/socket.gateway.ts')).toBe(true)
  })

  it('worker 闭包仍然装着它该有的东西（防「空闭包全绿」）', () => {
    for (const required of [
      'apps/worker/src/worker.module.ts',
      'apps/api/src/app/core.module.ts',
      'libs/config/src/index.ts',
      'libs/db/src/index.ts',
      // D4：SocketService 必须留在 worker（device.kick / user.shared 两个 @Global 端口实现注入它）
      'apps/api/src/socket/socket.service.ts',
      // cron 宿主
      'apps/api/src/modules/techniques/task/task.service.ts',
    ]) {
      expect(workerClosure.files.has(required), `${required} 应当在 worker 闭包内`).toBe(true)
    }
    expect(workerClosure.files.size).toBeGreaterThan(400)
  })

  it('隔离：CAP 求值链完全不在 worker 闭包里（D2 模块求值级）', () => {
    expectOutside('libs/security/src/cap/cap.service.ts')
    expectOutside('libs/security/src/cap/cap.module.ts')
    expectOutside('libs/guards/src/guards/cap.guard.ts')
    expectOutside('apps/api/src/modules/security/cap/cap.controller.ts')
    expectOutside('apps/api/src/modules/security/security.module.ts')
  })

  it('worker 不装配 Throttler（注册面），也不含 HTTP-only 三件套', () => {
    // throttler 的**注册面**（ThrottlerModule.forRootAsync + 内存 storage + 启动日志）
    expectOutside('libs/throttle/src/throttler.module.ts')
    expectOutside('libs/throttle/src/throttler.service.ts')
    expectOutside('apps/api/src/modules/techniques/tech.module.ts')
    // Express 中间件只在 NestApplication.init() 里生效
    expectOutside('apps/api/src/middleware/middleware.module.ts')
    // swagger 装配只有 api / cli 用得到
    expectOutside('apps/api/src/common/swagger/swagger.document.ts')
    // Socket gateway / adapter：createApplicationContext 下根本不会初始化，但也没必要加载
    expectOutside('apps/api/src/socket/socket.gateway.ts')
    expectOutside('apps/api/src/socket/socket.adapter.ts')
    expectOutside('apps/api/src/socket/socket.module.ts')
    // HTTP 包装模块（controller 宿主）
    expectOutside('apps/api/src/modules/app/app.module.ts')
    expectOutside('apps/api/src/modules/app/monitor/user/user-http.module.ts')
    // 组合根本身
    expectOutside('apps/api/src/app/app.module.ts')
    expectOutside('apps/cli/src/export-openapi.ts')
  })

  it('@nestjs/throttler 的残余 import 面被钉死（已知残留，不允许再长）', () => {
    // 为什么这里不是 toBe(false)：@nestjs/throttler 在 worker 闭包里**无法**清干净 ——
    // libs/auth/src/index.ts:62 导出了 otp-throttle.guard.ts（passport OTP mixin guard，
    // 继承 ThrottlerGuard）。要切断它得动 auth barrel，超出本批范围（见报告「需要 Lead 拍板」）。
    // 它的危害与 CAP 不同：@nestjs/throttler 顶层只有类定义，没有文件 / 信号副作用；
    // 真正有害的是 ThrottlerModule.forRootAsync 的**注册**（上面那条断言已经拦掉）。
    //
    // 钉子形态：精确相等。新增任何一条 import 都会让本行变红。
    const importers = [...workerClosure.files]
      .filter(file => specifiersOf(resolve(SERVER_ROOT, file)).includes('@nestjs/throttler'))
      .sort()

    expect(importers).toEqual([
      'libs/auth/src/modules/otp/guard/otp-throttle.guard.ts',
      'libs/guards/src/guards/throttler.guard.ts',
    ])
  })
})
