import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  assertWalnutPgAppBootstrapPassword,
  WALNUT_PG_APP_BOOTSTRAP_PASSWORD,
} from '@walnut-server/config/utils/pg-app-password'
import { validateConfig } from '@walnut-server/config/validation'
import { describe, expect, it } from 'vitest'

/**
 * L5：RLS 引导密码生产防呆（apps/docs/src/zh-CN/content/plans/data-scope-remediation-plan.md §4.1 / 批 6）。
 *
 * 两层：
 * 1. 纯函数三分支 —— development（引导密码放行）/ stage（引导密码抛）/ production
 *    （强密码放行，引导密码抛）；
 * 2. 单一事实源漂移守卫 —— 迁移 `1793360000000-DataScopePhase3Rls.ts` 内嵌的
 *    `BOOTSTRAP_PASSWORD` 字面量必须等于 `WALNUT_PG_APP_BOOTSTRAP_PASSWORD`。
 *
 * 为什么是文本对账而不是 import：迁移由 typeorm CLI 以 Node 原生类型剥离单独加载
 * （无 tsconfig paths，`@walnut-server/*` 解析不到），无法 import config 侧常量；
 * 两处各留字面量 + 本 spec 对账，与 `dto-entity.drift.spec.ts` /
 * `eslint-data-scope-entities.drift.spec.ts` 的守卫风格一致。
 *
 * 本 spec 放在 apps/api/src 下而非 libs/config 旁边：单测 vitest 只收
 * `apps/api/src/**\/*.spec.ts`（apps/api/vitest.config.ts），验证 libs 纯函数的
 * spec 一律放这里（先例：common/repository/data-scope.rls.spec.ts 测 libs/db）。
 */

describe('assertWalnutPgAppBootstrapPassword（L5 生产防呆）', () => {
  it('development + 引导密码 → 放行（本地/集成库引导是设计内用法）', () => {
    expect(() => assertWalnutPgAppBootstrapPassword('development', WALNUT_PG_APP_BOOTSTRAP_PASSWORD))
      .not
      .toThrow()
  })

  it('未设置 NODE_ENV（本地裸 node）→ 放行', () => {
    expect(() => assertWalnutPgAppBootstrapPassword(undefined, WALNUT_PG_APP_BOOTSTRAP_PASSWORD))
      .not
      .toThrow()
  })

  it('stage + 引导密码 → 启动即失败，报错说明原因与处置', () => {
    const act = () => assertWalnutPgAppBootstrapPassword('stage', WALNUT_PG_APP_BOOTSTRAP_PASSWORD)

    expect(act).toThrow(/开发引导密码/)
    // 处置必须可执行：预建强密码角色 + 改 DATABASE_PG_APP_PASS
    expect(act).toThrow(/预建 walnut_app 角色/)
    expect(act).toThrow(/DATABASE_PG_APP_PASS/)
    expect(act).toThrow(/NODE_ENV=stage/)
  })

  it('production + 引导密码 → 启动即失败', () => {
    expect(() => assertWalnutPgAppBootstrapPassword('production', WALNUT_PG_APP_BOOTSTRAP_PASSWORD))
      .toThrow(/NODE_ENV=production/)
  })

  it('大写环境名（Production）同样拒绝（环境名比较前统一转小写）', () => {
    expect(() => assertWalnutPgAppBootstrapPassword('Production', WALNUT_PG_APP_BOOTSTRAP_PASSWORD))
      .toThrow(/开发引导密码/)
    expect(() => assertWalnutPgAppBootstrapPassword('STAGE', WALNUT_PG_APP_BOOTSTRAP_PASSWORD))
      .toThrow(/开发引导密码/)
  })

  it('production + 强密码 → 放行', () => {
    expect(() => assertWalnutPgAppBootstrapPassword('production', 'a-strong-production-password'))
      .not
      .toThrow()
  })

  it('调用点接线：validateConfig 在 stage + 引导密码时先于类校验抛错（F2 校验层）', () => {
    expect(() => validateConfig({
      NODE_ENV: 'stage',
      DATABASE_PG_APP_USER: 'walnut_app',
      DATABASE_PG_APP_PASS: WALNUT_PG_APP_BOOTSTRAP_PASSWORD,
    })).toThrow(/开发引导密码/)
  })
})

/**
 * 仓库根：从本 spec 所在目录向上找 `pnpm-workspace.yaml`（与
 * eslint-data-scope-entities.drift.spec.ts 同款；不用 import.meta —— server 是
 * module=commonjs，import.meta 过不了 tsc --noEmit）。
 */
function findRepoRoot(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(`找不到仓库根（从 ${start} 向上没有 pnpm-workspace.yaml）`)
    }
    dir = parent
  }
}

const MIGRATION_PATH = join(
  findRepoRoot(__dirname),
  'apps/server/apps/api/migrations/1793360000000-DataScopePhase3Rls.ts',
)

/** 抽取迁移内嵌的引导密码字面量；解析失败返回 null（守卫按失败处理，绝不静默通过） */
function extractMigrationBootstrapPassword(source: string): string | null {
  const match = /const BOOTSTRAP_PASSWORD = '([^']*)'/.exec(source)
  return match?.[1] ?? null
}

describe('引导密码单一事实源（迁移文本 ↔ config 常量）', () => {
  const ACTION_HINT = '改引导密码必须同时改 libs/config/src/utils/pg-app-password.ts 与迁移内的 BOOTSTRAP_PASSWORD'

  it('迁移文件定位正确（路径解析失效时本守卫必须是红的，而不是空断言通过）', () => {
    expect(existsSync(MIGRATION_PATH), `未找到 ${MIGRATION_PATH}（本 spec 的仓库根定位失效）`).toBe(true)
  })

  it('迁移内 BOOTSTRAP_PASSWORD ≡ WALNUT_PG_APP_BOOTSTRAP_PASSWORD', () => {
    const source = readFileSync(MIGRATION_PATH, 'utf8')

    expect(extractMigrationBootstrapPassword(source), `未从迁移解析到 BOOTSTRAP_PASSWORD。${ACTION_HINT}`)
      .toBe(WALNUT_PG_APP_BOOTSTRAP_PASSWORD)
    // 任务口径的文本级断言：迁移文件文本包含配置侧常量的字面量
    expect(source).toContain(`'${WALNUT_PG_APP_BOOTSTRAP_PASSWORD}'`)
  })

  it('迁移 SQL 实际使用该常量（防「常量还在、CREATE ROLE 改用别的密码」）', () => {
    const source = readFileSync(MIGRATION_PATH, 'utf8')

    // 迁移里的真实形态：`CREATE ROLE ${ROLE} LOGIN PASSWORD '${BOOTSTRAP_PASSWORD}'`
    expect(source, `CREATE ROLE 未使用 BOOTSTRAP_PASSWORD。${ACTION_HINT}`)
      .toContain(`PASSWORD '\${BOOTSTRAP_PASSWORD}'`)
  })

  it('对账守卫自测：篡改迁移文本后解析结果变化（不是空断言）', () => {
    const source = readFileSync(MIGRATION_PATH, 'utf8')
    const tampered = source.replace(/const BOOTSTRAP_PASSWORD = '[^']*'/, 'const BOOTSTRAP_PASSWORD = \'drifted\'')

    expect(extractMigrationBootstrapPassword(source)).not.toBe('drifted')
    expect(extractMigrationBootstrapPassword(tampered)).toBe('drifted')
    expect(extractMigrationBootstrapPassword('const OTHER = 1')).toBeNull()
  })
})
