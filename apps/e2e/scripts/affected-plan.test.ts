/**
 * `scripts/affected-plan.ts` 的映射规则单测。
 *
 * 这里钉的是「改了哪类文件 → 跑什么」的**契约**：映射写错的后果是漏测（改了 guards 却只跑
 * smoke）或反复全量（把文档改动当代码）。安全网（未知 → 全量）优先级最高，单独钉住。
 */
import { describe, expect, it } from 'vitest'
import { affectedTargetProfiles, classifyAffectedPaths, describeAffectedPlan } from './affected-plan.ts'

describe('classifyAffectedPaths —— 精确映射', () => {
  it('admin 登录页 / auth 视图 → smoke + pages + journey（映射是加法）', () => {
    const plan = classifyAffectedPaths(['apps/admin/src/views/auth/index.vue'])
    expect(plan.mode).toBe('projects')
    expect(plan.projects).toEqual(['smoke', 'pages', 'journey'])
    expect(plan.rebuild).toBe(false)
    expect(plan.reason).toContain('views/auth/index.vue')
  })

  it('admin auth 模块（store/user-auth.ts、api/auth.ts）→ smoke + journey', () => {
    expect(classifyAffectedPaths(['apps/admin/src/store/modules/user/user-auth.ts']).projects).toEqual(['smoke', 'journey'])
    expect(classifyAffectedPaths(['apps/admin/src/api/auth.ts']).projects).toEqual(['smoke', 'journey'])
    expect(classifyAffectedPaths(['apps/admin/src/api/auth/mfa.ts']).projects).toEqual(['smoke', 'journey'])
  })

  it('server guards / system / ip / middleware → risk', () => {
    for (const changedPath of [
      'apps/server/libs/guards/src/jwt-access.guard.ts',
      'apps/server/libs/system/src/device.service.ts',
      'apps/server/libs/ip/src/ip.service.ts',
      'apps/server/apps/api/src/middleware/real-ip.middleware.ts',
    ]) {
      const plan = classifyAffectedPaths([changedPath])
      expect(plan.mode, changedPath).toBe('projects')
      expect(plan.projects, changedPath).toEqual(['risk'])
    }
  })

  it('admin 页面视图 / 路由 → pages（扩面批次 E4）', () => {
    for (const changedPath of [
      'apps/admin/src/views/system/user/index.vue',
      'apps/admin/src/views/index/home/index.vue',
      'apps/admin/src/router/index.ts',
      'apps/admin/src/router/routes/mainout.ts',
    ]) {
      const plan = classifyAffectedPaths([changedPath])
      expect(plan.mode, changedPath).toBe('projects')
      expect(plan.projects, changedPath).toEqual(['pages'])
    }
  })

  it('admin socket / 锁屏（组件 / store / user_lock API）→ journey（扩面批次 E5）', () => {
    for (const changedPath of [
      'apps/admin/src/socket/index.ts',
      'apps/admin/src/components/App/AppLock/lock.vue',
      'apps/admin/src/store/modules/app/app-lock.ts',
      'apps/admin/src/api/system/user_lock.ts',
    ]) {
      const plan = classifyAffectedPaths([changedPath])
      expect(plan.mode, changedPath).toBe('projects')
      expect(plan.projects, changedPath).toEqual(['journey'])
    }
  })

  it('server 侧 auth / identity / socket 仍是未映射（走全量安全网，等 E5 落地再收窄）', () => {
    for (const changedPath of [
      'apps/server/libs/auth/src/auth.service.ts',
      'apps/server/libs/identity/user_lock/user-lock.service.ts',
      'apps/server/apps/api/src/socket/socket.gateway.ts',
    ]) {
      const plan = classifyAffectedPaths([changedPath])
      expect(plan.mode, changedPath).toBe('all')
      expect(plan.projects, changedPath).toEqual([])
    }
  })

  it('auth 视图 + risk 守卫同时命中 → 四个 project 都跑（映射是加法）', () => {
    const plan = classifyAffectedPaths([
      'apps/admin/src/views/auth/index.vue',
      'apps/server/libs/guards/src/jwt-access.guard.ts',
    ])
    expect(plan.mode).toBe('projects')
    expect(plan.projects).toEqual(['smoke', 'risk', 'pages', 'journey'])
  })

  it('pages 与 journey 同时命中（avatar 页 + socket）→ 按表顺序去重', () => {
    const plan = classifyAffectedPaths([
      'apps/admin/src/socket/event.ts',
      'apps/admin/src/views/me/index.vue',
      'apps/admin/src/views/me/index.vue',
    ])
    expect(plan.mode).toBe('projects')
    expect(plan.projects).toEqual(['pages', 'journey'])
  })
})

describe('classifyAffectedPaths —— 重新封板 + 全量', () => {
  it.each([
    ['apps/server/db/seed/sys_user.json'],
    ['apps/server/db/seed'],
    ['apps/server/apps/api/migrations/0002-new.ts'],
    ['apps/e2e/scripts/prepare-db.ts'],
    ['tooling/scripts/src/db/seed-pg.ts'],
  ])('数据路径 %s → all + rebuild', (changedPath) => {
    const plan = classifyAffectedPaths([changedPath])
    expect(plan.mode).toBe('all')
    expect(plan.rebuild).toBe(true)
    expect(plan.reason).toContain(changedPath)
  })

  it('数据路径 + 文档混合：数据判定优先', () => {
    const plan = classifyAffectedPaths(['README.md', 'apps/server/db/seed/sys_menu.json'])
    expect(plan.mode).toBe('all')
    expect(plan.rebuild).toBe(true)
  })
})

describe('classifyAffectedPaths —— 全量 / 跳过', () => {
  it('apps/e2e/** → 全量（不重新封板）', () => {
    const plan = classifyAffectedPaths(['apps/e2e/tests/risk/device.spec.ts'])
    expect(plan.mode).toBe('all')
    expect(plan.rebuild).toBe(false)
  })

  it('apps/e2e 下的文档也按 E2E 自身变化 → 全量', () => {
    expect(classifyAffectedPaths(['apps/e2e/README.md']).mode).toBe('all')
  })

  it('未知路径（根 package.json）→ 全量（安全网）', () => {
    const plan = classifyAffectedPaths(['package.json'])
    expect(plan.mode).toBe('all')
    expect(plan.rebuild).toBe(false)
    expect(plan.reason).toContain('package.json')
  })

  it('未知源码路径（apps/server 其它模块）→ 全量', () => {
    expect(classifyAffectedPaths(['apps/server/apps/api/src/main.ts']).mode).toBe('all')
  })

  it('只改文档（apps/docs/** 与任意 *.md）→ 跳过', () => {
    const plan = classifyAffectedPaths([
      'apps/docs/src/zh-CN/content/plans/e2e-optimization-plan.md',
      'README.md',
      'apps/docs/AGENTS.md',
    ])
    expect(plan.mode).toBe('skip')
    expect(plan.projects).toEqual([])
    expect(plan.reason).toContain('只改了文档')
  })

  it('文档 + 已知映射（guards）→ 不是跳过，跑 risk', () => {
    const plan = classifyAffectedPaths([
      'README.md',
      'apps/server/libs/guards/src/jwt-access.guard.ts',
    ])
    expect(plan.mode).toBe('projects')
    expect(plan.projects).toEqual(['risk'])
  })

  it('空改动 → 跳过', () => {
    const plan = classifyAffectedPaths([])
    expect(plan.mode).toBe('skip')
    expect(plan.reason).toContain('没有改动')
  })

  it('windows 反斜杠与 ./ 前缀归一化后仍能命中', () => {
    const plan = classifyAffectedPaths(['.\\apps\\admin\\src\\views\\auth\\index.vue'])
    expect(plan.mode).toBe('projects')
    expect(plan.projects).toEqual(['smoke', 'pages', 'journey'])
    expect(plan.changedPaths).toEqual(['apps/admin/src/views/auth/index.vue'])
  })

  it('重复路径去重（同一判定不重复触发）', () => {
    const plan = classifyAffectedPaths([
      'apps/server/libs/guards/src/a.ts',
      './apps/server/libs/guards/src/a.ts',
    ])
    expect(plan.changedPaths).toHaveLength(1)
  })
})

describe('describeAffectedPlan', () => {
  it('skip / all / projects 三种摘要都可读', () => {
    expect(describeAffectedPlan(classifyAffectedPaths(['README.md']))).toContain('跳过 E2E')
    expect(describeAffectedPlan(classifyAffectedPaths(['package.json']))).toContain('全量')
    expect(describeAffectedPlan(classifyAffectedPaths(['apps/server/db/seed/a.json']))).toContain('重新封板')
    expect(describeAffectedPlan(classifyAffectedPaths(['apps/admin/src/views/auth/index.vue']))).toContain('--project=smoke')
  })
})

describe('affectedTargetProfiles', () => {
  it('skip ⇒ []；projects ⇒ 同列表；all ⇒ 五个命名 profile', () => {
    expect(affectedTargetProfiles(classifyAffectedPaths(['README.md']))).toEqual([])
    expect(affectedTargetProfiles(classifyAffectedPaths(['apps/server/libs/guards/src/a.ts']))).toEqual(['risk'])
    expect(affectedTargetProfiles(classifyAffectedPaths(['apps/admin/src/views/me/index.vue']))).toEqual(['pages'])
    expect(affectedTargetProfiles(classifyAffectedPaths(['apps/admin/src/socket/index.ts']))).toEqual(['journey'])
    expect(affectedTargetProfiles(classifyAffectedPaths(['apps/e2e/tests/x.spec.ts'])))
      .toEqual(['smoke', 'risk', 'network', 'pages', 'journey'])
  })
})
