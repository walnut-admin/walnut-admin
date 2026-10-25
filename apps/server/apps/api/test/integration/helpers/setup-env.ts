import * as process from 'node:process'

import { INTEGRATION_DATABASE_NAME } from './integration.const'

/**
 * 集成测试 env 注入 —— 必须在任何 Nest 模块被加载前生效（setupFiles 的执行时机满足）。
 *
 * 为什么不依赖 vitest 的 `test.env`：这里需要的保证是「Nest 模块加载前值已在 `process.env`
 * 上」—— `libs/config/src/config.module.ts` 在**模块加载期**读 `process.env.NODE_ENV` 决定
 * 加载哪个 env 文件（vitest 默认把 NODE_ENV 设成 `test`，会导致 ConfigModule 去找不存在的
 * `.env.test`），`libs/config/src/modules/database.config.ts` 读 `process.env.DATABASE_NAME`
 * 决定 dbName。setupFiles 直接赋值拿到第一手保证，不赌 `test.env` 的注入位置与时机。
 *
 * DATABASE_NAME 是独立的集成库名：**绝对不许指向 `walnut-admin-nestjs`**（迁移基准数据）。
 */
process.env.NODE_ENV = 'development'
process.env.DATABASE_NAME = INTEGRATION_DATABASE_NAME
// PG 集成库与 Mongo 集成库同名但独立实例：globalSetup 编程式跑 migration，
// 运行时 PG DataSource（pg.config.ts 读 DATABASE_PG_NAME）必须指向同一个库
process.env.DATABASE_PG_NAME = INTEGRATION_DATABASE_NAME
