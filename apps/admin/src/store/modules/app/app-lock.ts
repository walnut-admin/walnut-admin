import type { SystemUserLockStatus } from '@walnut/api-types'
import type { Ref } from 'vue'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import type { ValueOfAppConstLockMode } from '@/const'
import type { IStoreApp } from '@/store/types'
import { defineStore } from 'pinia'
import { getCurrentInstance } from 'vue'
import { getLockStatusAPI, lockAPI, unlockAPI } from '@/api/system/user_lock'
import { AppCoreFn1 } from '@/core'
import { useAppRouterPush } from '@/router/index'
import { mainoutConst, mainoutLockRoute } from '@/router/routes/mainout'
import { AppSocketEvents } from '@/socket/event'
import { registerSocketEvent } from '@/socket/index'
import { useAppStoreMenu } from '@/store/modules/app/app-menu'
import { useAppStoreRoute } from '@/store/modules/app/app-route'
import { useAppStoreUserProfile } from '@/store/modules/user/user-profile'
import { StoreKeys } from '../../constant'
import { store } from '../../pinia'

const useAppStoreLockInside = defineStore(StoreKeys.APP_LOCK, {
  state: (): IStoreApp.Lock => ({
    enable: true,
    loading: false,
    locked: false,
    lockRoute: {},
    lockCrossDevice: false,
    lockMode: 'default',
    lockIdleSec: 0,
    lockSecuritySec: 0,
    // L1（2026-11-27）：服务端 read 新增的布尔位（G4）—— 前端据此区分「未设密码 / 已设密码」
    lockPwdSet: false,
  }),

  getters: {
    getEnable: (state) => state.enable,
    getLoading: (state) => state.loading,
    getLockCrossDevice: (state) => state.lockCrossDevice,
    getLocked: (state) => state.locked,
    getLockRoute: (state) => {
      if (!state.lockRoute) {
        const appStoreMenu = useAppStoreMenu()

        return { name: appStoreMenu.getIndexMenuName }
      }
      return state.lockRoute
    },
    getLockMode: (state) => state.lockMode,
    getLockIdleSec: (state) => state.lockIdleSec,
    getLockSecuritySec: (state) => state.lockSecuritySec,
    getLockPwdSet: (state) => state.lockPwdSet,
  },

  actions: {
    setLockPreference(payload: SystemUserLockStatus) {
      this.setLocked(payload.locked)
      this.setLockCrossDevice(payload.lockCrossDevice)
      this.setLockRoute(payload.lockRoute)
      this.setLockMode(payload.lockMode)
      this.setLockIdleSec(payload.lockIdleSec)
      this.setLockSecuritySec(payload.lockSecuritySec)
      this.setLockPwdSet(payload.lockPwdSet)
    },

    setLockPwdSet(payload: boolean) {
      this.lockPwdSet = payload
    },

    setLocked(payload: boolean) {
      this.locked = payload
    },

    setLockCrossDevice(payload: boolean) {
      this.lockCrossDevice = payload
    },

    setLockRoute(payload: IStoreApp.LockRoute) {
      this.lockRoute = payload
    },

    setLockMode(payload: ValueOfAppConstLockMode) {
      this.lockMode = payload
    },

    setLockIdleSec(payload: number) {
      this.lockIdleSec = payload
    },

    setLockSecuritySec(payload: number) {
      this.lockSecuritySec = payload
    },

    /**
     * @description init lock state
     */
    async onInitLockState() {
      const res = await getLockStatusAPI()
      this.setLockPreference(res)

      if (res.locked) {
        await this.logicAfterLock()
      }
    },

    /**
     * @description lock from socket
     */
    async lockFromSocket() {
      if (!this.getEnable) {
        return
      }

      registerSocketEvent(AppSocketEvents.LOCK, async () => {
        await this.logicAfterLock()
      })
    },

    /**
     * @description lock
     */
    async lock(route: Ref<RouteLocationNormalizedLoaded>) {
      if (!this.getEnable) {
        return
      }

      this.loading = true

      try {
        await lockAPI({
          name: route.value.name as string,
          query: route.value.query,
          params: route.value.params,
        })

        await this.logicAfterLock()
      } finally {
        this.loading = false
      }
    },

    /**
     * @description logic after lock
     */
    async logicAfterLock(push = true) {
      const appStoreRoute = useAppStoreRoute()
      appStoreRoute.addDynamicAuthRoute(mainoutLockRoute)
      if (push) await useAppRouterPush({ name: mainoutConst.lock.name, replace: true })
    },

    /**
     * @description logic after unlock
     */
    async logicAfterUnlock() {
      const userStoreProfile = useAppStoreUserProfile()
      await userStoreProfile.getProfile()
      await AppCoreFn1()
      await useAppRouterPush(this.getLockRoute)

      // const appStoreRoute = useAppStoreRoute()
      // appStoreRoute.removeDynamicAuthRoute(mainoutLockRoute)
    },

    /**
     * @description unlock from socket
     */
    async unlockFromSocket() {
      if (!this.getEnable) {
        return
      }
      registerSocketEvent(AppSocketEvents.UNLOCK, () => {
        this.logicAfterUnlock()
      })
    },

    /**
     * @description unlock
     *
     * D4（2026-11-27）：失败时**留在锁屏页**并把错误原样抛给调用方（密码框据此显示
     * 就地红字 / 退避倒计时）。旧实现在任何错误上都 `goIndex()` —— 40000（密码错 /
     * 退避中）会把用户从 `/lock` 打回首页，看起来像「解锁成功了但又什么都没有」。
     * default / idle 的免密按钮也走这里，失败仍由调用方决定提示方式。
     */
    async unLock(lockPwdHash?: string) {
      if (!this.getEnable) {
        return
      }

      this.loading = true

      try {
        await unlockAPI(lockPwdHash)
        await this.logicAfterUnlock()
      } finally {
        this.loading = false
      }
    },
  },
})

const useAppStoreLockOutside = () => useAppStoreLockInside(store)

export function useAppStoreLock() {
  if (getCurrentInstance()) return useAppStoreLockInside()
  return useAppStoreLockOutside()
}
