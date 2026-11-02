import { WalnutAdminConstAppEnv } from '@walnut-server/const/app/env'

/**
 * 数据权限三期（RLS）运行时角色 `walnut_app` 的**开发引导密码**。
 *
 * 迁移 `apps/api/migrations/1793360000000-DataScopePhase3Rls.ts` 的
 * `CREATE ROLE ... PASSWORD` 内嵌同一字面量（仅本地/集成库引导：角色已存在时
 * DO 块跳过，不会覆盖生产密码）。迁移文件由 typeorm CLI 以 Node 原生类型剥离
 * **单独加载**（无 Nest DI、无 tsconfig paths —— `@walnut-server/*` 在那边无法解析），
 * 不能 import 本常量；两处字面量的漂移由
 * `apps/api/src/common/config/pg-app-password.spec.ts` 的文本对账守卫兜住
 * （与 dto-entity / eslint-data-scope-entities 两个 drift spec 同一风格）。
 */
export const WALNUT_PG_APP_BOOTSTRAP_PASSWORD = 'walnut_app_dev_only'

/**
 * 生产语义的环境名 —— 引导密码在这两个环境一律拒绝启动（其余环境按开发/测试放行）。
 *
 * 环境名复用 `libs/const` 的 `WalnutAdminConstAppEnv`，不在 config 侧另维护一份：
 * libs 是同一 Nest 内部 monorepo 的源码集，`libs/config` 已有 `@walnut-server/const`
 * 的运行时导入先例（`libs/config/src/modules/middleware.config.ts` 的
 * `WalnutAdminConstAppHTTPMethods`），构建时由 tsconfig paths 统一解析。
 */
const PRODUCTION_LIKE_ENVS: ReadonlySet<string> = new Set([
  WalnutAdminConstAppEnv.STAGE,
  WalnutAdminConstAppEnv.PROD,
])

/**
 * L5 生产防呆（apps/docs/src/zh-CN/content/plans/data-scope-remediation-plan.md §4.1）：
 * `NODE_ENV` 为 stage / production 时，`DATABASE_PG_APP_PASS` 不允许等于 dev 引导密码。
 *
 * 为什么要有这一条：F2 已经让 `DATABASE_PG_APP_USER/PASS` 启动必填，但「必填」挡不住
 * 把本地引导密码配进预发/生产 —— 迁移对已存在的角色跳过 `CREATE ROLE`，那种部署会
 * 带着一个人尽皆知的密码跑起来，RLS 角色等于没有保护。这里让它**启动即失败**，
 * 与 F2「缺失必填」同一风格（响亮报错，而不是静默降级）。
 *
 * 环境名比较前统一转小写（`NODE_ENV=Production` 与 `production` 同义）。
 * 纯函数：env 与密码都由调用方显式传入，便于单测三分支；调用点在
 * `validation.ts` 的 `validateConfig`（F2 校验层）与 `modules/pg.config.ts`。
 *
 * 处置口径（报错里必须说清）：生产/预发须在跑迁移前**预建** `walnut_app` 角色
 * （NOSUPERUSER NOBYPASSRLS）并配置强密码，再把 `DATABASE_PG_APP_PASS` 设为该密码。
 */
export function assertWalnutPgAppBootstrapPassword(
  nodeEnv: string | undefined,
  appPass: string,
): void {
  if (appPass !== WALNUT_PG_APP_BOOTSTRAP_PASSWORD) {
    return
  }

  if (!PRODUCTION_LIKE_ENVS.has((nodeEnv ?? '').toLowerCase())) {
    return
  }

  throw new Error(
    `[config] DATABASE_PG_APP_PASS 仍是开发引导密码（${WALNUT_PG_APP_BOOTSTRAP_PASSWORD}），`
    + `NODE_ENV=${nodeEnv} 拒绝启动。该密码只用于本地开发 / 集成测试库引导`
    + '（迁移 1793360000000-DataScopePhase3Rls 的 CREATE ROLE 缺省值，角色已存在时跳过）。'
    + '生产 / 预发必须在跑迁移前预建 walnut_app 角色（NOSUPERUSER NOBYPASSRLS）并配置强密码，'
    + '再把 DATABASE_PG_APP_PASS 设为该强密码（见 apps/docs/src/zh-CN/content/plans/modernization-roadmap.md §6.2 部署注意）。',
  )
}
