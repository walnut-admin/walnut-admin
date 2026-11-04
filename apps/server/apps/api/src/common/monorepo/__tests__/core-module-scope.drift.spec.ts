import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { importClosure, readModuleDeclarations, SERVER_ROOT, shortestChain, walkModuleGraph } from '../module-graph'

/**
 * G3 —— AppCoreModule 的**作用域**（R1 §4.2 草案 A，拍板 D1/D2 的直接推论）。
 *
 * 阶段 1 的形态是「worker 换入口，api 一行不动」：
 *
 *   AppModule (api + cli，全量图)  ──不变──►  所有业务 + HTTP 装配
 *   AppCoreModule (worker 专用)    ──新增──►  只含两进程都要的业务/基础设施
 *
 * 于是 imports 名单出现**两份**（AppCoreModule 与 AppModule 有重叠）。重叠本身不可怕 ——
 * 怕的是漂移：有人把 SecurityModule（CAP 宿主）或 throttle 注册抄进 core，api 侧照常绿，
 * worker 侧悄悄把 CAP 又装了回去。本 spec 就是钉住这条边。
 *
 * 为什么断言的是「传递闭包与 HTTP-only 集合无交集」而不是「core.imports ⊆ AppModule.imports」：
 * 后者字面成立不了 —— core 必须引用 lib 级数据面模块（SysAuthModule / SysSystemModule /
 * SysIdentityModule），而这些在 AppModule 里是**嵌在** AuthModule / SystemModule 内的，
 * 不在 AppModule.imports 那一层。真正要守的性质是「core 绝不把任何 HTTP-only 模块拉进来」，
 * 它对传递闭包成立，也就覆盖了那份名单。
 */

const APP_MODULE_ENTRY = 'apps/api/src/app/app.module.ts'
const CORE_MODULE_ENTRY = 'apps/api/src/app/core.module.ts'
const TECH_MODULE_FILE = 'apps/api/src/modules/techniques/tech.module.ts'
const TECH_CORE_MODULE_FILE = 'apps/api/src/modules/techniques/tech-core.module.ts'
const SOCKET_MODULE_FILE = 'apps/api/src/socket/socket.module.ts'
const SOCKET_CORE_MODULE_FILE = 'apps/api/src/socket/socket-core.module.ts'

/**
 * **HTTP-only 模块（按文件）** —— 进了 worker 就是装错地方。逐条给判据：
 *
 * - middleware.module.ts：Express 中间件，只在 NestApplication.init() 里生效（D1）
 * - security.module.ts：CAP 宿主，4 个 controller，CAP 写路径只在这里（D2）
 * - health.module.ts：一个 /health controller（D2）
 * - throttler.module.ts：ThrottlerModule.forRootAsync + 进程内计数器，tracker 是 req.realIp（D1/D3）
 * - tech.module.ts：本身只是聚合，但它是**第 12 条 APP_GUARD（Throttler）的注册处**（D1/C1）
 * - socket.module.ts：SocketGateway + SocketAuthMiddleware，适配器只在 api 装配（D1）
 * - app.module.ts（modules/app）：AppAppModule 含 demo / deleted / error / monitor 的 controller（D2）
 * - monitor.module.ts / user-http.module.ts：monitor 的 HTTP 组合（D2）
 * - *-http.module.ts 三件：auth / system / identity 的 controller 宿主（D2）
 * - app.module.ts（app/）：AppModule 自身 —— worker 换入口的意义就在于**不再 import 它**（拍板 D2）
 */
const HTTP_ONLY_MODULE_FILES = [
  'apps/api/src/app/app.module.ts',
  'apps/api/src/middleware/middleware.module.ts',
  'apps/api/src/modules/app/app.module.ts',
  'apps/api/src/modules/app/monitor/monitor.module.ts',
  'apps/api/src/modules/app/monitor/user/user-http.module.ts',
  'apps/api/src/modules/auth/auth-http.module.ts',
  'apps/api/src/modules/security/security.module.ts',
  'apps/api/src/modules/system/deleted/deleted-http.module.ts',
  'apps/api/src/modules/system/identity/identity-http.module.ts',
  'apps/api/src/modules/system/system-http.module.ts',
  'apps/api/src/modules/techniques/health/health.module.ts',
  'apps/api/src/modules/techniques/tech.module.ts',
  'apps/api/src/socket/socket.module.ts',
  'libs/throttle/src/throttler.module.ts',
]

const coreGraph = walkModuleGraph(CORE_MODULE_ENTRY)
const apiGraph = walkModuleGraph(APP_MODULE_ENTRY)

/**
 * 剥注释后再做文本断言。
 *
 * 理由：本套 spec 的注释里**故意**写着被禁的类名（解释为什么不许出现）。拿裸源码做
 * not.toContain 会把解释当违规 —— 断言要盯着代码，不是盯着文档。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function moduleDeclarationsOf(file: string) {
  return readModuleDeclarations(resolve(SERVER_ROOT, file))
}

describe('g3 · AppCoreModule 作用域（route A：worker 换入口，api 不动）', () => {
  it('入口存在且不是空模块（AppCoreModule）', () => {
    expect(coreGraph.length, `${CORE_MODULE_ENTRY} 必须能被解析出模块图`).toBeGreaterThan(0)
    expect(coreGraph[0].className).toBe('AppCoreModule')
    expect(coreGraph[0].imports.length).toBeGreaterThan(5)
  })

  it('传递闭包与 HTTP-only 集合零交集（AppCoreModule，模块级）', () => {
    const reached = coreGraph.map(node => node.file).sort()
    const leaked = reached.filter(file => HTTP_ONLY_MODULE_FILES.includes(file))
    expect(leaked, `这些 HTTP-only 模块被 AppCoreModule 拉进 worker 了：${leaked.join(', ')}`)
      .toEqual([])
  })

  it('传递闭包与 HTTP-only 集合零交集（文件级，穿 barrel）', () => {
    // 上面那条走的是模块图：遇到指向 barrel（index.ts，无 @Module 声明）的别名边就断了，
    // 深度不可靠。这条用**文件级 import 闭包**重算一遍 —— 它只问「谁 require 谁」，
    // 穿 barrel、穿 re-export，与 G1 用的是同一个解析器。
    const closure = importClosure(CORE_MODULE_ENTRY)
    const leaked = HTTP_ONLY_MODULE_FILES
      .filter(file => closure.files.has(file))
      .map((file) => {
        const chain = shortestChain(closure, CORE_MODULE_ENTRY, file)
        return `${file} <- ${String(chain === null ? '(unknown)' : chain.join(' -> '))}`
      })
    expect(leaked, `HTTP-only 文件进了 AppCoreModule 的文件级闭包: ${leaked.join(' | ')}`)
      .toEqual([])

    // 反证：同一个解析器对 api 入口必须命中它们，否则这条断言是空转
    const apiClosure = importClosure(APP_MODULE_ENTRY)
    for (const file of [
      'apps/api/src/middleware/middleware.module.ts',
      'apps/api/src/modules/security/security.module.ts',
      'libs/throttle/src/throttler.module.ts',
      'apps/api/src/socket/socket.module.ts',
    ]) {
      expect(apiClosure.files.has(file), `${file} 应当在 api 闭包内（否则本断言空转）`).toBe(true)
    }
  })

  it('core 里没有任何 APP_GUARD 注册（12 条一条都不许进）', () => {
    const guards = coreGraph.flatMap(node =>
      node.guardClasses.map(className => `${node.file}#${className}`),
    )
    expect(guards).toEqual([])
  })

  it('tech-core 是 AppTechModule 的**子集**（两份名单防漂移）', () => {
    const full = moduleDeclarationsOf(TECH_MODULE_FILE)[0]
    const core = moduleDeclarationsOf(TECH_CORE_MODULE_FILE)[0]

    expect(core.className).toBe('AppTechCoreModule')
    const extra = core.imports.filter(identifier => !full.imports.includes(identifier))
    expect(extra, `AppTechCoreModule 引入了 AppTechModule 没有的模块：${extra.join(', ')}`)
      .toEqual([])
    // 反向：core 必须真的比 full 少东西，否则这个拆分没意义
    expect(core.imports.length).toBeLessThan(full.imports.length)
    // 少掉的必须恰好是 health + throttler（两件 HTTP-only）
    const missing = full.imports.filter(identifier => !core.imports.includes(identifier))
    expect(missing.sort()).toEqual(['AppTechHealthModule', 'AppTechThrottlerModule'])
  })

  it('socket-core 只给 SocketService，不给 gateway；SocketModule（api）照旧两样都有', () => {
    const apiSocket = stripComments(readFileSync(resolve(SERVER_ROOT, SOCKET_MODULE_FILE), 'utf8'))
    const coreSocket = stripComments(readFileSync(resolve(SERVER_ROOT, SOCKET_CORE_MODULE_FILE), 'utf8'))

    // D4：SocketService 被 device.kick.service / user.shared.service 注入 ⇒ 必须留 core
    expect(coreSocket).toContain('SocketService')
    expect(coreSocket).toContain('@Global()')
    // gateway / auth middleware 只在 api 侧
    expect(coreSocket).not.toContain('SocketGateway')
    expect(coreSocket).not.toContain('SocketAuthMiddleware')
    expect(apiSocket).toContain('SocketGateway')
  })

  it('api 侧的组合根一行没动（D1：12 条 guard 原地不动，AppModule.imports 不变）', () => {
    // 只做「还在原位」的存在性核对：AppModule 仍直接引这些都 HTTP 装配件
    const appModule = readFileSync(resolve(SERVER_ROOT, APP_MODULE_ENTRY), 'utf8')
    for (const keep of [
      'AppMiddlewareModule',
      'SecurityModule',
      'AppTechModule',
      'SocketModule',
      'DiscoveryModule',
      'AppBootstrapTaskModule',
    ]) {
      expect(appModule).toContain(keep)
    }
    // AppModule 绝不能改引 AppCoreModule（那会把 worker 的入口和 api 的入口绑死）
    expect(appModule).not.toContain('AppCoreModule')
    expect(apiGraph.length).toBeGreaterThan(20)
  })
})
