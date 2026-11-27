import type { Router } from 'vue-router'
import { isNil, isUndefined } from 'lodash-es'
import { AppCoreFn1 } from '@/core'
import { useAppRouter } from '@/router/index'
import { useAppStoreLock } from '@/store/modules/app/app-lock'
import { useAppStoreMenu } from '@/store/modules/app/app-menu'
import { useAppStoreRoute } from '@/store/modules/app/app-route'
import { useAppStoreUserAuth } from '@/store/modules/user/user-auth'
import { useAppStoreUserProfile } from '@/store/modules/user/user-profile'
import { mainoutConst, mainoutMissingPermissionsRoute } from '../routes/mainout'

export function createBeforeEachGuard(router: Router) {
  router.beforeEach(async (to, _from) => {
    const userStoreAuth = useAppStoreUserAuth()
    const appStoreMenu = useAppStoreMenu()
    const appStoreRoute = useAppStoreRoute()

    // white list paths will enter directly
    if (appStoreRoute.isPathInWhiteList(to.path)) {
      // Login and push to auth page, will go index menu
      if (userStoreAuth.getAccessToken && to.path === mainoutConst.auth.path)
        return { name: appStoreMenu.getIndexMenuName }
      return true
    }

    // since almost all the routes are fetch from backend
    // default _auth would be undefined
    // this flag below should only works for hard-coded routes in frontend codes
    // no need to excute the logic below, like profile or permisison
    if (!isUndefined(to.meta?._auth) && !to.meta._auth) return true

    // No token, next to auth page and return
    if (!userStoreAuth.getAccessToken) return { path: mainoutConst.auth.path, replace: true }

    // Get user info
    const userStoreProfile = useAppStoreUserProfile()
    if (isNil(userStoreProfile.profile?.id)) {
      try {
        // fetch profile
        await userStoreProfile.getProfile()
      } catch (error) {
        // 锁定态**硬刷新 / 新标签页**：`getProfile` 被 Lock guard 拦成 40118，响应拦截器
        // 已注册 `/lock` 路由并 replace 过去。这里必须接住并补读一次 LockFree 的锁状态 ——
        // 否则 app-lock store 停在默认值（`lockMode=default`），`/lock` 渲染成免密按钮，
        // 用户点不动也看不到密码框（J1 的 reload 腿实测：还会因未接住的 rejection 弹
        // 「页面遇到无法恢复的错误」全屏遮罩）。与 `ExecuteCoreFnAfterAuth` 的 D3 收口同一写法。
        if (error instanceof Error && error.message === 'User Locked') {
          await useAppStoreLock().onInitLockState()
          return to.fullPath
        }
        throw error
      }
      // LINK https://router.vuejs.org/guide/advanced/dynamic-routing.html#adding-routes-inside-navigation-guards
      return to.fullPath
    }

    // user locked, early return
    const appStoreLock = useAppStoreLock()
    if (appStoreLock.getLocked) {
      return true
    }

    // not locked => Get permission
    if (appStoreMenu.menus.length === 0) {
      // At this step, user has login but didn't got dynamic routes generated
      // Below we call app core fn1 to handle logic
      const hasPermissions = await AppCoreFn1()

      // If no permissions, redirect to missing permissions page
      if (!hasPermissions) {
        const { addRoute, hasRoute } = useAppRouter()
        if (!hasRoute(mainoutConst.missingPermissions.name))
          addRoute(mainoutConst.root.name, mainoutMissingPermissionsRoute)
        return { name: mainoutConst.missingPermissions.name, replace: true }
      }

      // LINK https://router.vuejs.org/guide/advanced/dynamic-routing.html#adding-routes-inside-navigation-guards
      return to.fullPath
    }
  })
}
