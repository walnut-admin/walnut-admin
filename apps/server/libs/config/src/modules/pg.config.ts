import * as process from 'node:process'
import { registerAs } from '@nestjs/config'

/**
 * PG 连接配置（数据权限三期拆双角色）。
 *
 * - `DATABASE_PG_USER/PASS`：**管理通道**（迁移 / globalSetup 建库 / dev 手工 DDL /
 *   `db:export:pg` / seed）。superuser 或 BYPASSRLS，天然绕 RLS；
 * - `DATABASE_PG_APP_USER/PASS`：**运行时通道**（TypeORM DataSource）。该角色是
 *   NOSUPERUSER NOBYPASSRLS 非表 owner，RLS 真正生效。
 *
 * **不允许回退管理角色**（P1-2）：回退会让 RLS 静默失效——启动时报错，而不是
 * 带着一个看起来正常、实际没有天花板的连接跑起来。
 */
export default registerAs('pg', () => {
  const appUser = process.env.DATABASE_PG_APP_USER
  const appPass = process.env.DATABASE_PG_APP_PASS

  if (appUser === undefined || appUser === '' || appPass === undefined || appPass === '') {
    throw new Error(
      '[pg.config] DATABASE_PG_APP_USER / DATABASE_PG_APP_PASS 未配置。'
      + '请执行 `pnpm setup-env`（解密 env-local）并确认迁移 1793360000000-DataScopePhase3Rls '
      + '已创建 walnut_app 角色；生产环境按部署文档预建角色并配置强密码。',
    )
  }

  return {
    host: process.env.DATABASE_PG_HOST,
    port: Number.parseInt(process.env.DATABASE_PG_PORT),
    user: appUser,
    pass: appPass,
    name: process.env.DATABASE_PG_NAME,
  }
})
