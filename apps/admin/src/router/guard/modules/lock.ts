import type { Router } from 'vue-router'
import { mainoutConst } from '@/router/routes/mainout'
import { useAppStoreLock } from '@/store/modules/app/app-lock'
import { useAppStoreMenu } from '@/store/modules/app/app-menu'

/**
 * 锁屏期间必须放行的**非锁屏页**：MFA 两条路由。
 *
 * D3（2026-11-27）：锁定态的浏览器在 fallback（登录口令）链路上可能吃到 40115
 * （本设备未完成 MFA 验证）。响应拦截器会 `AppRouter.replace(/mfa-verified)`，
 * 而本守卫若把目标一律打回 `/lock`，40115 的验证页永远打不开 —— 用户被卡死在锁屏页
 * 且无法完成兜底。MFA 页本身是「证明身份」的入口，不构成锁定绕过：
 * 验证完成后 `ExecuteCoreFnAfterAuth` 仍会按锁定态回到 `/lock`。
 */
const LOCK_FREE_ROUTE_NAMES: readonly string[] = [
  mainoutConst.lock.name,
  mainoutConst.mfaRequired.name,
  mainoutConst.mfaVerified.name,
]

export function createLockGuard(router: Router) {
  const appStoreLock = useAppStoreLock()
  const appStoreMenu = useAppStoreMenu()

  // beforeEach
  router.beforeEach((to) => {
    // 1. If already on the lock screen page (or the MFA escape hatch), allow direct passage
    if (to.name !== undefined && LOCK_FREE_ROUTE_NAMES.includes(to.name as string)) return true

    // 2. Locked status && target lock route is specified
    if (appStoreLock.getLocked && appStoreLock.getLockRoute) {
      // Route already registered, but current "to" is not the lock screen page
      if (to.name !== mainoutConst.lock.name) {
        return { name: mainoutConst.lock.name, replace: true }
      }
    }

    // 3. Unlocked status but still on lock screen page → redirect to homepage
    if (
      !appStoreLock.getLocked &&
      router.hasRoute(mainoutConst.lock.name) &&
      to.name === mainoutConst.lock.name
    ) {
      return { name: appStoreMenu.getIndexMenuName, replace: true }
    }

    // 4. Allow normal passage by default
    return true
  })
}
