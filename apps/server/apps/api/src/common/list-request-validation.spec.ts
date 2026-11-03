import type { ClassConstructor } from 'class-transformer'
import {
  AppDemoDTOListRequest,
  AppLoggerDTOListRequest,
  AppMonitorCacheDTOListRequest,
  AppSettingDTOListRequest,
} from '@walnut-server/app-domain'
import {
  SysDeptDTOListRequest,
  SysDeviceDTOListRequest,
  SysDictDataDTOListRequest,
  SysDictTypeDTOListRequest,
  SysEmployeeDTOListRequest,
  SysLangDTOListRequest,
  SysLocaleDTOListRequest,
  SysLogAuthDTOListRequest,
  SysLogOperateDTOListRequest,
  SysMenuDTOListRequest,
  SysPostDTOListRequest,
  SysRoleDTOListRequest,
} from '@walnut-server/system'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { AppMonitorUserDTOListRequest } from '@/modules/app/monitor/user/dto/user.dto'
import { SystemDeletedDTOListRequest } from '@/modules/system/deleted/dto/deleted.dto'
import { SysUserDTOListRequest } from '@/modules/system/user/dto/user.dto'

/**
 * list 三槽位开启 `nestedWhenPresent` 之后的**回归守卫**（批次 1 · P0）。
 *
 * 背景：`libs/list/src/list.dto.ts` 的 query / sort / page 三个槽位在 2026-11 之前只挂
 * `Allow()`（`required: false`），内层约束（`sort[].field` 的 onlyIn 白名单、
 * `page.pageSize` 的 max、query 各字段的类型）**全部只进 swagger**。打开之后，
 * 任何"现存合法请求"都必须继续通过 —— 本 spec 用 R1 从 20 个 api-spec 里抄出来的
 * **真实请求体**逐条跑一遍 ValidationPipe 等价校验（`whitelist + forbidNonWhitelisted`）。
 *
 * 如果这里红了，说明打开嵌套校验把某个现存调用方 400 掉了 —— 要么修 DTO，要么回退缩小范围。
 *
 * ## 批次 4-A 起：入参是 `filters: [{ field, op, value }]`，不再是 `query: {...}`
 *
 * 上面的请求体已按**显式算子**重写（旧 `query` 的 ILIKE 语义 = `op: 'like'`、
 * 等值语义 = `op: 'eq'`、数组语义 = `op: 'in'`）。下面新增的一组用例钉住新契约的边界：
 * - `query` 槽位已不存在 ⇒ 顶层白名单直接拒（40099 的入口）；
 * - `filters[]` 的 op 必须在枚举内、未声明键要被拒；
 * - `filters: []` / 缺省都合法（与 sort 槽位同口径）。
 */

interface ICase {
  name: string
  dto: ClassConstructor<object>
  body: Record<string, unknown>
}

const cases: ICase[] = [
  // ---- libs/app-domain ----
  {
    name: 'POST /app/demo/list（api-spec demo.api-spec.ts:174）',
    dto: AppDemoDTOListRequest,
    body: { filters: [{ field: 'demoString', op: 'like', value: 'api-r1' }], sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }], page: { page: 1, pageSize: 10 } },
  },
  {
    name: 'POST /app/logger/list（logger.api-spec.ts:93 sort=fileMTime）',
    dto: AppLoggerDTOListRequest,
    body: { filters: [{ field: 'fileName', op: 'like', value: 'api-r1' }], sort: [{ field: 'fileMTime', order: 'descend', priority: 1 }], page: { page: 1, pageSize: 10 } },
  },
  {
    name: 'POST /app/logger/list（logger.api-spec.ts:111 sort=[]）',
    dto: AppLoggerDTOListRequest,
    body: { filters: [{ field: 'fileName', op: 'like', value: 'api-r1' }, { field: 'logType', op: 'eq', value: 'error' }], sort: [], page: { page: 1, pageSize: 10 } },
  },
  {
    name: 'POST /app/logger/list（logger.api-spec.ts:181 filters=[]）',
    dto: AppLoggerDTOListRequest,
    body: { filters: [], sort: [], page: { page: 1, pageSize: 10 } },
  },
  {
    name: 'POST /app/monitor/cache/list（monitor.api-spec.ts:103 sort=key）',
    dto: AppMonitorCacheDTOListRequest,
    body: { filters: [{ field: 'key', op: 'like', value: 'APISPEC:r1' }], sort: [{ field: 'key', order: 'ascend', priority: 1 }], page: { page: 1, pageSize: 10 } },
  },
  {
    name: 'POST /app/setting/list（setting.api-spec.ts:160）',
    dto: AppSettingDTOListRequest,
    body: { filters: [{ field: 'settingKey', op: 'like', value: 'k.c1' }], sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }], page: { page: 1, pageSize: 10 } },
  },

  // ---- apps/api ----
  {
    name: 'POST /app/monitor/user/list（monitor-user.api-spec.ts:180）',
    dto: AppMonitorUserDTOListRequest,
    body: { filters: [{ field: 'visitorId', op: 'like', value: 'visitor-r1' }], sort: [{ field: 'firstVisitAt', order: 'ascend', priority: 1 }], page: { page: 1, pageSize: 10 } },
  },
  {
    name: 'POST /app/monitor/user/list（monitor-user.api-spec.ts:291 filters=[]）',
    dto: AppMonitorUserDTOListRequest,
    body: { filters: [], sort: [], page: { page: 1, pageSize: 10 } },
  },
  {
    name: 'POST /system/deleted/list（deleted.api-spec.ts:146 filters.content）',
    dto: SystemDeletedDTOListRequest,
    body: { filters: [{ field: 'content', op: 'like', value: 'api-r1' }], page: { page: 1, pageSize: 50 } },
  },
  {
    name: 'POST /system/user/list（user.api-spec.ts:195）',
    dto: SysUserDTOListRequest,
    body: { filters: [{ field: 'userName', op: 'like', value: 'api-r1-L1' }], sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }], page: { page: 1, pageSize: 10 } },
  },

  // ---- libs/system ----
  {
    name: 'POST /system/dept/list（dept.api-spec.ts:197）',
    dto: SysDeptDTOListRequest,
    body: { filters: [{ field: 'deptCode', op: 'like', value: 'P-R1' }], page: { page: 1, pageSize: 10 } },
  },
  {
    name: 'POST /system/dept/list（dept.api-spec.ts:324 只带 page）',
    dto: SysDeptDTOListRequest,
    body: { page: { page: 1, pageSize: 10 } },
  },
  {
    name: 'POST /system/device/list（device.api-spec.ts:158）',
    dto: SysDeviceDTOListRequest,
    body: { filters: [{ field: 'deviceId', op: 'like', value: 'dev-r1' }], sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }], page: { page: 1, pageSize: 10 } },
  },
  {
    name: 'POST /system/dict/type/list（dict.api-spec.ts:202）',
    dto: SysDictTypeDTOListRequest,
    body: { filters: [{ field: 'type', op: 'like', value: 't-r1' }], sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }], page: { page: 1, pageSize: 10 } },
  },
  {
    name: 'POST /system/dict/data/list（dict.api-spec.ts:274 filters.typeId=uuid）',
    dto: SysDictDataDTOListRequest,
    body: { filters: [{ field: 'typeId', op: 'eq', value: '9f8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' }], sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }], page: { page: 1, pageSize: 10 } },
  },
  {
    name: 'POST /system/employee/list（employee.api-spec.ts:135）',
    dto: SysEmployeeDTOListRequest,
    body: { filters: [{ field: 'employeeNo', op: 'like', value: 'e-r1' }], page: { page: 1, pageSize: 10 } },
  },
  {
    name: 'POST /system/lang/list（lang.api-spec.ts:162）',
    dto: SysLangDTOListRequest,
    body: { filters: [{ field: 'lang', op: 'like', value: 'en_US' }], sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }], page: { page: 1, pageSize: 10 } },
  },
  {
    name: 'POST /system/locale/list（locale.api-spec.ts:219）',
    dto: SysLocaleDTOListRequest,
    body: { filters: [{ field: 'key', op: 'like', value: 'api.spec.r1r1r1r1' }], sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }], page: { page: 1, pageSize: 2 } },
  },
  {
    name: 'POST /system/log/auth/list（log-auth.api-spec.ts:111）',
    dto: SysLogAuthDTOListRequest,
    body: { filters: [{ field: 'deviceId', op: 'like', value: 'dev-r1' }], sort: [{ field: 'authenticatedAt', order: 'descend', priority: 1 }], page: { page: 1, pageSize: 50 } },
  },
  {
    name: 'POST /system/log/auth/list（log-auth.api-spec.ts:158 filters.type 数组）',
    dto: SysLogAuthDTOListRequest,
    body: { filters: [{ field: 'deviceId', op: 'like', value: 'dev-r1' }, { field: 'type', op: 'in', value: ['opaque'] }], page: { page: 1, pageSize: 50 } },
  },
  {
    name: 'POST /system/log/operate/list（log-operate.api-spec.ts:102）',
    dto: SysLogOperateDTOListRequest,
    body: { filters: [{ field: 'deviceId', op: 'like', value: 'dev-r1' }], sort: [{ field: 'operatedAt', order: 'descend', priority: 1 }], page: { page: 1, pageSize: 50 } },
  },
  {
    name: 'POST /system/menu/list（menu.api-spec.ts:348）',
    dto: SysMenuDTOListRequest,
    body: { filters: [{ field: 'name', op: 'like', value: 'm-r1-L1' }], sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }], page: { page: 1, pageSize: 10 } },
  },
  {
    name: 'POST /system/post/list（post.api-spec.ts:113）',
    dto: SysPostDTOListRequest,
    body: { filters: [{ field: 'postCode', op: 'like', value: 'p-r1' }], page: { page: 1, pageSize: 10 } },
  },
  {
    name: 'POST /system/role/list（role.api-spec.ts:262）',
    dto: SysRoleDTOListRequest,
    body: { filters: [{ field: 'roleName', op: 'like', value: 'r-r1-L1' }], sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }], page: { page: 1, pageSize: 10 } },
  },
  {
    name: 'POST /system/role/list（real-data.api-spec.ts:250 filters=[] pageSize=100）',
    dto: SysRoleDTOListRequest,
    body: { filters: [], sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }], page: { page: 1, pageSize: 100 } },
  },
]

/** 与全局 ValidationPipe 同口径（main.ts:110-125） */
async function validateLikePipe(target: ClassConstructor<object>, body: Record<string, unknown>) {
  const instance = plainToInstance(target, body)
  return validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  })
}

describe('list 三槽位嵌套校验 · 现存调用回归', () => {
  it.each(cases)('$name 不产生校验错误', async ({ dto, body }) => {
    const errors = await validateLikePipe(dto, body)

    if (errors.length > 0) {
      // 输出可读的失败面，便于定位是哪个槽位/字段
      const detail = errors.map(e => ({
        property: e.property,
        constraints: Object.keys(e.constraints ?? {}),
        children: (e.children ?? []).map(c => ({
          property: c.property,
          constraints: Object.keys(c.constraints ?? {}),
          grandchildren: (c.children ?? []).map(g => ({ property: g.property, constraints: Object.keys(g.constraints ?? {}) })),
        })),
      }))
      throw new Error(`校验失败：${JSON.stringify(detail)}`)
    }

    expect(errors).toHaveLength(0)
  })

  it('page 缺省 / 空 sort 仍合法（default 裸对象已被实例化，不会触发 unknownValue）', async () => {
    expect(await validateLikePipe(SysUserDTOListRequest, {})).toHaveLength(0)
    expect(await validateLikePipe(SysUserDTOListRequest, { sort: [] })).toHaveLength(0)
    expect(await validateLikePipe(SysUserDTOListRequest, { filters: [] })).toHaveLength(0)
    expect(await validateLikePipe(SysUserDTOListRequest, { page: {} })).toHaveLength(0)
  })

  it('契约侧确认：sort[].order 的 false 仍被接受（contract 的 SortOrder 允许）', async () => {
    const errors = await validateLikePipe(SysUserDTOListRequest, {
      sort: [{ field: 'createdAt', order: false, priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })

    expect(errors).toHaveLength(0)
  })

  it('契约侧确认：page 越界/非整数会被 pageSize 的 max 与 int 拦住（新校验真正生效）', async () => {
    const tooBig = await validateLikePipe(SysUserDTOListRequest, { page: { page: 1, pageSize: 99999 } })
    expect(tooBig.flatMap(e => e.children ?? []).map(c => c.property)).toContain('pageSize')

    const notInt = await validateLikePipe(SysUserDTOListRequest, { page: { page: 1.5, pageSize: 10 } })
    expect(notInt.flatMap(e => e.children ?? []).map(c => c.property)).toContain('page')
  })

  it('sort[].priority 可缺省（R3 P2-4：历史行为允许缺省，builder 用 ?? 0 兜底）', async () => {
    expect(await validateLikePipe(SysUserDTOListRequest, {
      sort: [{ field: 'createdAt', order: 'ascend' }],
      page: { page: 1, pageSize: 10 },
    })).toHaveLength(0)
  })

  it('sort[].priority 显式给 0 也合法（缺省值即 0）', async () => {
    expect(await validateLikePipe(SysUserDTOListRequest, {
      sort: [{ field: 'createdAt', order: 'ascend', priority: 0 }],
      page: { page: 1, pageSize: 10 },
    })).toHaveLength(0)
  })

  it('sort[].priority 负数仍被拒（放宽不等于不校验）', async () => {
    const errors = await validateLikePipe(SysUserDTOListRequest, {
      sort: [{ field: 'createdAt', order: 'ascend', priority: -1 }],
      page: { page: 1, pageSize: 10 },
    })

    const priorityError = errors
      .find(e => e.property === 'sort')
      ?.children?.[0]
      ?.children
      ?.find(c => c.property === 'priority')
    expect(priorityError?.constraints?.min).toBeDefined()
  })

  it('契约侧确认：sort.field 白名单真正生效（旧实现只进 swagger）', async () => {
    const errors = await validateLikePipe(SysUserDTOListRequest, {
      sort: [{ field: 'ip', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })

    // sort 是数组槽位：error → sort → "0" → field
    const sortItem = errors.find(e => e.property === 'sort')?.children?.[0]
    const fieldError = sortItem?.children?.find(c => c.property === 'field')
    expect(fieldError?.constraints?.isIn).toBeDefined()
  })
})

describe('filters 槽位 · 批次 4-A 新契约边界', () => {
  it('旧 query 槽位已被移除：顶层白名单直接拒（40099 的入口）', async () => {
    const errors = await validateLikePipe(SysUserDTOListRequest, { query: { userName: 'x' } })

    expect(errors.map(e => e.property)).toContain('query')
    expect(Object.keys(errors[0]?.constraints ?? {})).toContain('whitelistValidation')
  })

  it('filters 缺省 / 空数组都合法', async () => {
    expect(await validateLikePipe(SysUserDTOListRequest, {})).toHaveLength(0)
    expect(await validateLikePipe(SysUserDTOListRequest, { filters: [] })).toHaveLength(0)
  })

  it('五种算子全部通过 DTO 校验（列类型裁决不在这里）', async () => {
    const ops = ['eq', 'like', 'in', 'range', 'isNull'] as const

    for (const op of ops) {
      const errors = await validateLikePipe(SysUserDTOListRequest, {
        filters: [{ field: 'createdAt', op, value: op === 'isNull' ? undefined : 'x' }],
      })
      expect(errors, `op=${op}`).toHaveLength(0)
    }
  })

  it('算子不在枚举内 ⇒ isEnum 拦下', async () => {
    const errors = await validateLikePipe(SysUserDTOListRequest, {
      filters: [{ field: 'userName', op: 'gt', value: 'x' }],
    })

    const item = errors.find(e => e.property === 'filters')?.children?.[0]
    expect(item?.children?.find(c => c.property === 'op')?.constraints?.isEnum).toBeDefined()
  })

  it('filters[] 里的未声明键被拒（forbidNonWhitelisted 下钻生效）', async () => {
    const errors = await validateLikePipe(SysUserDTOListRequest, {
      filters: [{ field: 'userName', op: 'like', value: 'x', bogus: 1 }],
    })

    const item = errors.find(e => e.property === 'filters')?.children?.[0]
    expect(item?.children?.find(c => c.property === 'bogus')?.constraints?.whitelistValidation).toBeDefined()
  })
})
