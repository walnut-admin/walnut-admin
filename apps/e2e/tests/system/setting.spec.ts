/**
 * 模块 spec ③：应用设置（app_setting 的读写 + **服务端写路径自带缓存刷新**）。
 *
 * 服务端真源（写断言前已对照）：
 * - `AppSettingController` 只有 create / read / update / list / `cache/refresh` —— **没有 delete**
 *   （设置是全局配置小表；删除不在 API 面，用例收尾只能走 PG）；
 * - `AppSettingService.create/update` 在提交后 `extractAppSettingIntoCache()`（`appSettings.cache`
 *   的进程内 memo 同步清掉）—— 所以改一条**已知 key** 后，`GET /app/setting/private` 立即读到新值，
 *   不需要再调 `POST /app/setting/cache/refresh`；
 * - R2 的 U11 已经覆盖「裸 SQL 改库 + 手动 cache/refresh」这条通道；本用例**不重复它**，
 *   聚焦设置自身的语义：CRUD、列表过滤、写路径自动刷新、显式 refresh 端点仍可用。
 *
 * 选 `app.functional.front.transition` 做自动刷新判据的原因：它由
 * `getFunctionalFrontTransition()` 解析成 `{ status, scope, globalValue, localKey }`，
 * `globalValue` 会原样出现在 `/app/setting/private` 的 `transition.value` 里 —— 可读、无副作用
 * （只是一个过渡动画名），且用例结束会恢复原值。
 */
import type { AppSettings } from '@walnut/api-types'
import type { AppSettingListPage } from '../../lib/protocol/api-types.ts'
import { randomBytes } from 'node:crypto'
import { deleteAppSettingByKey, readAppSettingValue, withPg } from '../../lib/pg.ts'
import { AppRoutes } from '../../lib/protocol/contract.ts'
import { rootClient } from '../../lib/protocol/root-client.ts'
import { expect, test } from '../fixtures.ts'

/** 服务端 `WalnutAdminConstAppSettingKeys.APP_FUNCTIONAL_FRONT_TRANSITION`（server-only const，未上 contract） */
const TRANSITION_SETTING_KEY = 'app.functional.front.transition'
/** 服务端 `WalnutAdminConstAppSettingType.FUNCTIONAL`（server-only const，未上 contract） */
const SETTING_TYPE_FUNCTIONAL = 'functional'

interface TransitionSettingValue {
  status: boolean
  scope: string
  globalValue: string
  localKey: string
}

interface PrivateSettings {
  transition: { status: boolean; mode: string; value: string }
}

async function readPrivateTransition(
  client: Awaited<ReturnType<typeof rootClient>>,
): Promise<PrivateSettings['transition']> {
  const settings = await client.root<PrivateSettings>('GET', AppRoutes.SETTING_PRIVATE)
  return settings.transition
}

test(
  '应用设置：CRUD + 列表过滤 + 写路径自动刷新（不依赖 cache/refresh）',
  { tag: '@smoke' },
  async () => {
    const root = await rootClient()
    const prefix = `e2e.setting.${Date.now()}-${randomBytes(2).toString('hex')}`
    let createdId = ''
    let transitionId = ''
    let originalTransitionValue = ''
    let transitionMutated = false

    try {
      // 1. 公开设置：结构断言（sign-free 端点；字段缺失 / 改名时先红）
      const publicSettings = await root.root<{
        auth: { opaque: { enable: boolean; register: boolean; forget: boolean } }
        frontend: { fullScreen: boolean; locale: boolean; dark: boolean; search: boolean }
      }>('GET', AppRoutes.SETTING_PUBLIC)
      expect(typeof publicSettings.auth.opaque.enable, 'public 设置缺 auth.opaque.enable').toBe(
        'boolean',
      )
      expect(typeof publicSettings.auth.opaque.register).toBe('boolean')
      expect(typeof publicSettings.frontend.fullScreen).toBe('boolean')
      expect(typeof publicSettings.frontend.locale).toBe('boolean')

      // 2. 列表 + 过滤：seed 的 auth 设置存在（app.auth.*）
      const seedList = await root.root<AppSettingListPage>('POST', `${AppRoutes.SETTING}/list`, {
        filters: [{ field: 'settingKey', op: 'like', value: 'app.auth.' }],
        page: { page: 1, pageSize: 50 },
      })
      expect(seedList.total, 'app_setting 列表没有 app.auth.* 的 seed 行').toBeGreaterThan(0)
      const mfaSetting = seedList.data.find((row) => row.settingKey === 'app.auth.mfa')
      expect(mfaSetting, 'seed 的 app.auth.mfa 设置行不在列表里').not.toBeUndefined()
      expect(mfaSetting!.settingType).toBe('auth')
      expect(typeof mfaSetting!.settingValue).toBe('string')

      // 3. 新建设置（唯一 key）→ read / list 过滤都只命中这一行
      const created = await root.root<AppSettings>('POST', AppRoutes.SETTING, {
        settingKey: prefix,
        settingName: `${prefix} name`,
        settingValue: JSON.stringify({ enabled: true }),
        settingType: SETTING_TYPE_FUNCTIONAL,
        remark: 'e2e module spec',
      })
      createdId = created.id
      expect(created.settingKey).toBe(prefix)
      expect(created.settingType).toBe(SETTING_TYPE_FUNCTIONAL)

      const readBack = await root.root<AppSettings>('GET', `${AppRoutes.SETTING}/${createdId}`)
      expect(readBack.settingKey).toBe(prefix)
      expect(JSON.parse(readBack.settingValue!)).toEqual({ enabled: true })

      const createdList = await root.root<AppSettingListPage>('POST', `${AppRoutes.SETTING}/list`, {
        filters: [{ field: 'settingKey', op: 'eq', value: prefix }],
        page: { page: 1, pageSize: 20 },
      })
      expect(createdList.total).toBe(1)
      expect(createdList.data).toHaveLength(1)
      expect(createdList.data[0]!.id).toBe(createdId)

      // 4. update：value / name 一起换，read 回读
      const updated = await root.root<AppSettings>('PUT', `${AppRoutes.SETTING}/${createdId}`, {
        settingKey: prefix,
        settingName: `${prefix} renamed`,
        settingValue: JSON.stringify({ enabled: false }),
        settingType: SETTING_TYPE_FUNCTIONAL,
      })
      expect(updated.settingName).toBe(`${prefix} renamed`)
      expect(JSON.parse(updated.settingValue!)).toEqual({ enabled: false })

      // 5. 写路径自动刷新：先读一条已知 key 的原始设置行（列表 eq 过滤）
      const transitionList = await root.root<AppSettingListPage>(
        'POST',
        `${AppRoutes.SETTING}/list`,
        {
          filters: [{ field: 'settingKey', op: 'eq', value: TRANSITION_SETTING_KEY }],
          page: { page: 1, pageSize: 20 },
        },
      )
      expect(transitionList.total, `app_setting 缺 ${TRANSITION_SETTING_KEY}`).toBe(1)
      const transitionRow = transitionList.data[0]!
      transitionId = transitionRow.id ?? ''
      originalTransitionValue = transitionRow.settingValue ?? ''
      const originalParsed = JSON.parse(originalTransitionValue) as TransitionSettingValue

      const privateBefore = await readPrivateTransition(root)
      expect(
        privateBefore.value,
        'private 设置里的 transition 与 DB 行不一致（读到了别的来源？）',
      ).toBe(originalParsed.globalValue)

      const newTransitionValue = `e2e-transition-${Date.now()}`
      transitionMutated = true
      await root.root<AppSettings>('PUT', `${AppRoutes.SETTING}/${transitionId}`, {
        settingKey: TRANSITION_SETTING_KEY,
        settingName: transitionRow.settingName ?? TRANSITION_SETTING_KEY,
        settingValue: JSON.stringify({ ...originalParsed, globalValue: newTransitionValue }),
        settingType: transitionRow.settingType ?? SETTING_TYPE_FUNCTIONAL,
      })

      // 关键判据：**没有**调 cache/refresh，private 已读到新值（写路径自带 extractAppSettingIntoCache）
      const privateAfter = await readPrivateTransition(root)
      expect(privateAfter.value, 'setting update 后 private 设置没有自动刷新（缓存未失效）').toBe(
        newTransitionValue,
      )
      await withPg(async (pg) => {
        const dbValue = await readAppSettingValue(pg, TRANSITION_SETTING_KEY)
        expect(dbValue, 'setting update 没有落库').not.toBeNull()
        expect((JSON.parse(dbValue!) as TransitionSettingValue).globalValue).toBe(
          newTransitionValue,
        )
      })

      // 6. 恢复原值（同一端点；恢复后 private 必须回到原值 —— 自动刷新的反向闭环）
      await root.root<AppSettings>('PUT', `${AppRoutes.SETTING}/${transitionId}`, {
        settingKey: TRANSITION_SETTING_KEY,
        settingName: transitionRow.settingName ?? TRANSITION_SETTING_KEY,
        settingValue: originalTransitionValue,
        settingType: transitionRow.settingType ?? SETTING_TYPE_FUNCTIONAL,
      })
      transitionMutated = false
      await expect(readPrivateTransition(root)).resolves.toMatchObject({
        value: originalParsed.globalValue,
      })

      // 7. 显式 refresh 端点仍然可用（U11 的通道；这里只断言契约：返回 true）
      await expect(root.root<boolean>('POST', AppRoutes.SETTING_CACHE_REFRESH)).resolves.toBe(true)
    } finally {
      if (transitionMutated && transitionId !== '' && originalTransitionValue !== '') {
        await root
          .root('PUT', `${AppRoutes.SETTING}/${transitionId}`, {
            settingKey: TRANSITION_SETTING_KEY,
            settingName: TRANSITION_SETTING_KEY,
            settingValue: originalTransitionValue,
            settingType: SETTING_TYPE_FUNCTIONAL,
          })
          .catch(() => {})
      }
      if (createdId !== '') {
        // 没有 delete 端点：按 key 精确删（只删本用例造的那一行）
        await withPg((pg) => deleteAppSettingByKey(pg, prefix)).catch(() => {})
      }
    }
  },
)
