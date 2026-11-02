import type { OpenAPIObject } from '@nestjs/swagger'
import * as fs from 'node:fs'
import * as path from 'node:path'

import process from 'node:process'
import { NestFactory } from '@nestjs/core'
import { waitForQueueConnectionsReady } from '@walnut-server/queue'

// cli 与 api 同属 `@walnut/server` workspace，且根 tsconfig 的 rootDir 覆盖整个
// apps/server/ —— 组合根（AppModule）与 app 内部模块用相对路径直接取用（不新增
// 别名：`@/*` 固定指向 apps/api/src，在 cli 里用会让「当前是谁的源码」失去语义）。
import { AppModule } from '../../api/src/app/app.module'
import { createSwaggerDocument } from '../../api/src/common/swagger/swagger.document'
import { WalnutAdminLogger } from '../../api/src/modules/techniques/logger'

/**
 * 离线导出 OpenAPI 文档 → `apps/server/openapi.json`（check-in 仓库）。
 *
 * ## 为什么存在
 *
 * 前端类型真源：`packages/platform-web/api-types` 用 openapi-typescript 从这份 json 生成
 * `schema.d.ts`，admin 的 menu 模块（一期）直接消费生成别名。一致性由 prepush 的
 * 「openapi 一致性」段机械拦：重新导出 + 重新生成后 `git diff --exit-code`，漂移即红。
 *
 * ## 运行方式（为什么不是 `node` 直接跑 .ts）
 *
 * 经 `pnpm openapi:export`（package.json script）运行：`nest build cli`（SWC，装饰器与
 * emitDecoratorMetadata 必须经转换 —— Node 24 原生类型剥离**不支持装饰器**，与
 * data-source.cli.ts 能裸跑的前提相反）→ `node dist/apps/cli/src/export-openapi.js`。
 * 本文件自身遵守 data-source.cli.ts 同款约定：**只应从 apps/server/ 目录运行**
 * （env 定位与产物路径都用 `process.cwd()`）。
 *
 * ## 与 main.ts 的同源保证
 *
 * - 同一个 `createSwaggerDocument()`（common/swagger/swagger.document.ts：DocumentBuilder 链的
 *   唯一来源 + 按 guard 元数据批量注入 bearer 声明）；
 * - 同一个 `WalnutAdminLogger` 与 `NestFactory.create`（不 listen）—— 引导路径与集成测试
 *   的全量装配一致，只省掉静态资源 / 视图引擎 / websocket adapter / 全局 pipe 这几步
 *   「HTTP 服务期」的装配（它们不参与 schema 反射）。
 *
 * 确定性：版本号来自 `npm_package_version`（pnpm script 注入），schema 键序由 Nest 装饰器
 * 元数据顺序决定 —— 同版本重复导出应逐字节一致（`pnpm openapi:check` 的 git diff 靠这一点）。
 */

/** 产物路径：仓库内 check-in 的 `apps/server/openapi.json`（从 apps/server 目录跑，即 cwd） */
const OUTPUT_PATH = path.resolve(process.cwd(), 'openapi.json')

async function exportOpenAPI(): Promise<OpenAPIObject> {
  if (process.env.npm_package_version === undefined) {
    throw new Error(
      '[export-openapi] npm_package_version is undefined — run via `pnpm openapi:export` from apps/server (版本号必须可确定，否则导出物不稳定)',
    )
  }

  // 引导完整 AppModule（PG / Redis 需在线），不 listen —— 只为拿装饰器元数据反射出的 schema。
  // `NestFactory.create` 在 Nest 11 **不会**自动 init（生命周期钩子不跑，Redis/PG 客户端不连），
  // 必须显式 `app.init()` —— 与集成测试装配辅助 create-integration-app.ts 的 `await app.init()` 同款。
  const app = await NestFactory.create(AppModule, {
    logger: WalnutAdminLogger,
  })
  await app.init()

  try {
    // Bull processor 的 bclient / subscriber 是惰性连接，`app.init()` 返回时可能仍在
    // 握手；紧接着 close 会触发 ioredis 未处理的 `Connection is closed.`（Node 24
    // 默认 strict → 进程 1 退出、导出物不落盘）。先等连接就绪，关闭才走正常 quit。
    await waitForQueueConnectionsReady(app)

    // 与 main.ts 同一个组装点（options 唯一来源 + bearer 批量注入），导出物与在线文档同源
    return createSwaggerDocument(app)
  }
  finally {
    // 连接（PG / Redis / bull）随 app 生命周期关闭，进程才能干净退出
    await app.close()
  }
}

async function main(): Promise<void> {
  const document = await exportOpenAPI()

  // 2 空格缩进 + 结尾换行：diff 友好的稳定序列化形态
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(document, null, 2)}\n`, 'utf-8')

  const schemaCount = Object.keys(document.components?.schemas ?? {}).length
  console.log(`[export-openapi] written ${OUTPUT_PATH} (openapi ${document.openapi}, ${schemaCount} schemas)`)
}

void main()
