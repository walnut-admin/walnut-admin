import { randomUUID } from 'node:crypto'

/**
 * API 级测试的共享 fixture 工厂（渐进迁移的第一批：employee / monitor-user / deleted）。
 *
 * 收敛的是**重复最重的两样东西**：本轮唯一片段（seed8）与请求 payload 的骨架。
 * 这些 payload 的字段面由 DTO 的 whitelist/校验器钉住（employee 的工号/部门/岗位，
 * app_demo 的 IsUppercase/数组列，monitor state 的匿名上报形态），分散在各 spec 头部
 * 时改一个字段要改一排文件；集中后新增用例只给 tag/overrides。
 *
 * 设计边界：
 * - 只放**纯数据构造**，不碰 app/client/DB —— spec 的钩子与清理逻辑仍留在原文件；
 * - 返回普通对象（不是 DTO 实例）：HTTP 请求体本来就该是 plain JSON；
 * - 分页/排序等请求壳不在工厂范围（各 spec 的查询意图不同）。
 */

/** 本轮唯一片段（8 位 uuid 十六进制，可直接进 LIKE 清理判据） */
export function makeSeed8(): string {
  return randomUUID().slice(0, 8)
}

/** 全大写分组前缀（demoString 挂 IsUppercase，uuid 片段的字母要整体抬大写） */
export function makeUppercaseGroup(base: string, seed8: string): string {
  return `${base}-${seed8.toUpperCase()}`
}

export interface MakeEmployeeOptions {
  seed8: string
  /** 用例内标签（R1 / U1 / S1 …），拼进工号与姓名 */
  tag: string
  deptId: string
  /** 未定岗传 null / 省略 */
  postId?: string | null
  overrides?: Record<string, unknown>
}

/** 职工工号/清理前缀（spec 的 purgeRows 与本工厂共用同一判据） */
export function makeEmployeePrefix(seed8: string): string {
  return `apispec-employee-${seed8}`
}

/** 职工 create/update 的公共骨架（工号前缀与姓名模板收敛在这里） */
export function makeEmployee(options: MakeEmployeeOptions): Record<string, unknown> {
  return {
    employeeNo: `${makeEmployeePrefix(options.seed8)}-${options.tag}`,
    employeeName: `职工 ${options.tag}`,
    deptId: options.deptId,
    postId: options.postId ?? null,
    entryDate: '2026-01-01T00:00:00.000Z',
    status: 'active',
    ...options.overrides,
  }
}

/** app/demo 标准 CRUD payload（数组列显式给值：phase2 4.20 的 NOT NULL 列） */
export function makeDemo(demoString: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    demoString,
    demoPhoneNumber: `138${randomUUID().replaceAll('-', '').slice(0, 8)}`,
    demoNumber: 1,
    demoBoolean: true,
    demoDate: '2026-01-01T00:00:00.000Z',
    demoEnum: 1,
    demoMongoId: randomUUID(),
    demoObject: { o1: 'OBJ', o2: 2, o3: false },
    demoStringArray: ['1', 'a'],
    demoNumberArray: [-1, 2],
    demoBooleanArray: [true],
    demoDateArray: ['2026-01-01T00:00:00.000Z'],
    demoEnumArray: [1, 2],
    demoMongoIdArray: [randomUUID()],
    ...overrides,
  }
}

/** monitor 的访客标识（uq_monitor_visitor） */
export function makeMonitorVisitorId(seed8: string, suffix: string): string {
  return `vis-${seed8}-${suffix}`
}

export interface MakeMonitorStateOptions {
  visitorId: string
  auth: boolean
  /** 已登录上报才有；显式 null 用于「登出清空 user_id」语义 */
  userId?: string | null
  focus?: boolean
  left?: boolean
  currentRouter?: string | null
}

/** `POST /app/monitor/user/state` 的公共上报体（userId/currentRouter 缺省不出现） */
export function makeMonitorState(options: MakeMonitorStateOptions): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    visitorId: options.visitorId,
    auth: options.auth,
    focus: options.focus ?? false,
    left: options.left ?? false,
  }
  if (options.userId !== undefined) {
    payload.userId = options.userId
  }
  if (options.currentRouter !== undefined) {
    payload.currentRouter = options.currentRouter
  }
  return payload
}
