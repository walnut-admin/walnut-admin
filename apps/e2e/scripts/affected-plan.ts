/**
 * `e2e:affected` 的**纯映射规则**：把 `git diff --name-only <base>...HEAD` 的改动路径
 * 分类成「跳过 / 只跑某个 project / 全量（可含重新封板）」。
 *
 * 判据（与优化文档 P1-5 一致，安全网优先）：
 * 1. **数据路径**（seed / 迁移 / prepare-db / seed 工具）→ **重新封板 + 全量**：基线里的数据
 *    不等于新源码的数据，先重建再跑；
 * 2. `apps/e2e/**` → 全量：测试宿主自身改了，选择逻辑本身也不可信；
 * 3. 全是文档（`apps/docs/**` 或任意 `*.md`）→ 跳过（打印理由、退出 0）；
 * 4. admin 登录 / auth 相关 → smoke（auth 面同时触发 journey）；
 * 5. server guards / system / ip / middleware → risk；
 * 6. admin 页面视图 / 路由（`views` / `router`）→ pages（逐页渲染的扩面批次 E4）；
 * 7. admin socket / 锁屏（组件 / store / user_lock API）→ journey（跨端旅程扩面批次 E5）；
 * 8. **其它任何路径 → 全量**。未知改动宁可多跑，不能漏测 —— 这是整条映射的安全网。
 *
 * 一条改动可以同时命中多个 project（如 `views/auth/**` 既是 smoke 的登录面、也是 pages 的页面面
 * 与 journey 的旅程起点）—— 映射是**加法**，不是互斥分类。
 *
 * 只做纯字符串判断（不做 I/O），单测直接钉住上面每一条；git 调用在 `scripts/affected.ts`。
 */

import { isE2eDataPath } from './e2e-data-paths.ts'

/** 本脚本能直接选择的 project（network 不单独选：它依赖真实外网，属于全量的一部分）。 */
export type AffectedProject = 'smoke' | 'risk' | 'pages' | 'journey'

export interface AffectedPlan {
  /** skip = 不需要跑；projects = 只跑列出的 project；all = 全量 */
  mode: 'skip' | 'projects' | 'all'
  /** mode=projects 时按表顺序去重后的 project 列表 */
  projects: AffectedProject[]
  /** 是否要求先 `--rebuild-baseline`（数据路径变化时为 true；只对 mode=all 有意义） */
  rebuild: boolean
  /** 人读的判定理由（打印在计划里；含触发判定的路径） */
  reason: string
  /** 归一化后的改动路径（原样保留给调用方打印） */
  changedPaths: string[]
}

// 数据路径清单的唯一真源是 `scripts/e2e-data-paths.ts`（与 `data-key` 的基线漂移判据同一组
// 路径）：这里只用它回答「要不要重新封板 + 全量」，`data-key` 用它算树哈希。

/** admin 侧登录 / auth 相关（改这些先跑 smoke）。 */
const ADMIN_AUTH_PREFIXES = [
  'apps/admin/src/views/auth',
  'apps/admin/src/api/auth',
] as const
const ADMIN_AUTH_FILES = ['apps/admin/src/api/auth.ts'] as const

/** server 侧设备 / 风控 / 中间件（改这些先跑 risk）。 */
const RISK_PREFIXES = [
  'apps/server/libs/guards',
  'apps/server/libs/system',
  'apps/server/libs/ip',
  'apps/server/apps/api/src/middleware',
] as const

/** admin 页面视图 / 路由（改这些先跑 pages：逐页渲染与导航）。 */
const PAGES_PREFIXES = [
  'apps/admin/src/views',
  'apps/admin/src/router',
] as const

/** admin socket 客户端与锁屏（改这些先跑 journey：socket / 锁屏旅程）。 */
const JOURNEY_PREFIXES = [
  'apps/admin/src/socket',
  'apps/admin/src/components/App/AppLock',
] as const

/** 锁屏状态与 user_lock 管理端 API（文件级规则；auth 面另由 `isAdminAuthPath` 一并覆盖）。 */
const JOURNEY_FILES = [
  'apps/admin/src/store/modules/app/app-lock.ts',
  'apps/admin/src/api/system/user_lock.ts',
] as const

/** 路径归一化：Windows 反斜杠、前导 `./`、多余空白。 */
function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\//, '')
}

/** 目录匹配：路径等于目录本身，或在目录之下（按 `/` 边界，避免 `auth` 命中 `auth0`）。 */
function matchesDir(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`)
}

function isDataPath(path: string): boolean {
  return isE2eDataPath(path)
}

function isE2ePath(path: string): boolean {
  return matchesDir(path, 'apps/e2e')
}

function isDocsPath(path: string): boolean {
  return matchesDir(path, 'apps/docs') || path.endsWith('.md')
}

function isAdminAuthPath(path: string): boolean {
  if (ADMIN_AUTH_FILES.includes(path as (typeof ADMIN_AUTH_FILES)[number])) {
    return true
  }
  if (ADMIN_AUTH_PREFIXES.some(dir => matchesDir(path, dir))) {
    return true
  }
  // store/modules 下的 auth 模块（如 user/user-auth.ts）：目录名带 auth 也算
  return matchesDir(path, 'apps/admin/src/store/modules')
    && path.slice('apps/admin/src/store/modules/'.length).toLowerCase().includes('auth')
}

function isRiskPath(path: string): boolean {
  return RISK_PREFIXES.some(dir => matchesDir(path, dir))
}

function isAdminPagePath(path: string): boolean {
  return PAGES_PREFIXES.some(dir => matchesDir(path, dir))
}

/**
 * journey 的触发面：socket 客户端 / 锁屏（组件、store、user_lock API）与 admin 的 auth 面。
 *
 * auth 面同时是 smoke 的触发源 —— 登录冒烟与登录旅程是两条用例，映射是加法。
 * server 侧的 auth / identity / socket 目前**不**映射（仍走全量安全网）：E5 落地前，
 * 把它们单独收窄到 journey 会丢掉 risk 的 auth-matrix 覆盖。
 */
function isJourneyPath(path: string): boolean {
  if (isAdminAuthPath(path)) {
    return true
  }
  return JOURNEY_PREFIXES.some(dir => matchesDir(path, dir))
    || JOURNEY_FILES.includes(path as (typeof JOURNEY_FILES)[number])
}

/**
 * 分类一组改动路径（**纯函数**，不做任何 git / fs 调用）。
 *
 * 判定顺序即优先级：数据 > e2e 自身 > 文档-only > 精确映射 > 未知全量。
 */
export function classifyAffectedPaths(paths: readonly string[]): AffectedPlan {
  const changedPaths = [...new Set(paths.map(normalizePath).filter(path => path !== ''))]

  if (changedPaths.length === 0) {
    return {
      mode: 'skip',
      projects: [],
      rebuild: false,
      reason: 'base...HEAD 没有改动文件',
      changedPaths,
    }
  }

  const dataPath = changedPaths.find(isDataPath)
  if (dataPath !== undefined) {
    return {
      mode: 'all',
      projects: [],
      rebuild: true,
      reason: `数据路径变化（${dataPath}）：必须重新封板并跑全量`,
      changedPaths,
    }
  }

  const e2ePath = changedPaths.find(isE2ePath)
  if (e2ePath !== undefined) {
    return {
      mode: 'all',
      projects: [],
      rebuild: false,
      reason: `E2E 自身变化（${e2ePath}）：跑全量`,
      changedPaths,
    }
  }

  const nonDocs = changedPaths.filter(path => !isDocsPath(path))
  if (nonDocs.length === 0) {
    return {
      mode: 'skip',
      projects: [],
      rebuild: false,
      reason: `只改了文档（${changedPaths.join(', ')}），不跑 E2E`,
      changedPaths,
    }
  }

  const unknown = nonDocs.find(path => !isAdminAuthPath(path) && !isRiskPath(path)
    && !isAdminPagePath(path) && !isJourneyPath(path))
  if (unknown !== undefined) {
    return {
      mode: 'all',
      projects: [],
      rebuild: false,
      reason: `有未映射的改动（${unknown}）：按安全网跑全量`,
      changedPaths,
    }
  }

  const projects: AffectedProject[] = []
  const smokeTrigger = nonDocs.find(isAdminAuthPath)
  if (smokeTrigger !== undefined) {
    projects.push('smoke')
  }
  const riskTrigger = nonDocs.find(isRiskPath)
  if (riskTrigger !== undefined) {
    projects.push('risk')
  }
  const pagesTrigger = nonDocs.find(isAdminPagePath)
  if (pagesTrigger !== undefined) {
    projects.push('pages')
  }
  const journeyTrigger = nonDocs.find(isJourneyPath)
  if (journeyTrigger !== undefined) {
    projects.push('journey')
  }

  const triggers = [
    smokeTrigger === undefined ? null : `smoke ← ${smokeTrigger}`,
    riskTrigger === undefined ? null : `risk ← ${riskTrigger}`,
    pagesTrigger === undefined ? null : `pages ← ${pagesTrigger}`,
    journeyTrigger === undefined ? null : `journey ← ${journeyTrigger}`,
  ].filter((trigger): trigger is string => trigger !== null)

  return {
    mode: 'projects',
    projects,
    rebuild: false,
    reason: `按目录映射：${triggers.join('；')}`,
    changedPaths,
  }
}

/** 人读的计划摘要（CLI 与报告共用；纯函数）。 */
export function describeAffectedPlan(plan: AffectedPlan): string {
  if (plan.mode === 'skip') {
    return `跳过 E2E（${plan.reason}）`
  }
  if (plan.mode === 'all') {
    return `全量${plan.rebuild ? ' + 重新封板' : ''}（${plan.reason}）`
  }
  return `${plan.projects.map(project => `--project=${project}`).join(' ')}（${plan.reason}）`
}

/**
 * 机器可读计划的目标 profile 列表（`--json` 输出用；纯函数）。
 *
 * 为将来「按 affected 动态生成 CI matrix」留口：本批 nightly 是静态五 job（E4 / E5 落地前
 * pages / journey 为空跑），这个字段只是把「计划覆盖哪些 profile」说清楚，消费方不必自己
 * 推断 `mode` 与 `projects` 的组合。`all` 的覆盖面就是五个命名 profile；`skip` 是空列表。
 */
export function affectedTargetProfiles(plan: AffectedPlan): string[] {
  if (plan.mode === 'skip') {
    return []
  }
  if (plan.mode === 'all') {
    return ['smoke', 'risk', 'network', 'pages', 'journey']
  }
  return [...plan.projects]
}
