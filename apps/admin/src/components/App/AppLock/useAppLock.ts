import type { EffectScope } from 'vue'
import type { ValueOfAppConstLockMode } from '@/const/app'
import { debouncedWatch, tryOnUnmounted, useDocumentVisibility, useIdle, usePageLeave } from '@vueuse/core'
import { effectScope, watch } from 'vue'
import { AppConstLockMode } from '@/const/app'
import { useAppRouter } from '@/router/index'
import { useAppStoreLock } from '@/store/modules/app/app-lock'

/**
 * 锁屏模式的副作用装配。
 *
 * D5 / D6（2026-11-27）：
 * - **D5**：旧实现在 `watch(getLockIdleSec)` 的回调里重新赋值 `modeScope`，把外层
 *   `modeScope` 的引用丢掉 → 第一次 seconds 变化后，旧 scope 的 `useIdle` 监听器
 *   永远停不掉（页面卸载后仍在跑，切换模式也会叠加）。这里拆成**固定的模式 scope**
 *   + **可重建的 idle 子 scope**，每次重建前先 `stop()` 旧的。
 * - **D6**：security 模式的秒数只在 setup 时读一次，改设置后要刷新页面才生效。现在
 *   两种模式都用 `watch(seconds, { immediate: true })` 建/重建 `useIdle`，保存偏好后
 *   立刻按新秒数计时。
 */
export function useAppLock() {
  let lockScope: EffectScope | null = null
  let modeScope: EffectScope | null = null
  let idleScope: EffectScope | null = null

  const { currentRoute } = useAppRouter()
  const appStoreLock = useAppStoreLock()

  function stopIdle() {
    idleScope?.stop()
    idleScope = null
  }

  function stopMode() {
    stopIdle()
    modeScope?.stop()
    modeScope = null
  }

  function stopLock() {
    lockScope?.stop()
    lockScope = null
  }

  async function tryLock() {
    try {
      await appStoreLock.lock(currentRoute)
    }
    catch (error) {
      console.log(error)
    }
  }

  /**
   * 按当前秒数建一个 idle 探测器（旧探测器先停）。
   *
   * 必须 `idleScope.run(...)` 包住 `useIdle`：`useIdle` 内部用 `tryOnScopeDispose`
   * 注册清理，没有活动 scope 时监听器会泄漏（这也是 D5 的根因形态）。
   * `watch(seconds, …, { immediate: true })` 放在模式 scope 里，秒数变化即重建。
   */
  function setupIdleDetector(seconds: () => number) {
    watch(
      seconds,
      (value) => {
        stopIdle()

        if (!value) {
          return
        }

        idleScope = effectScope()
        idleScope.run(() => {
          const { idle } = useIdle(value * 1000)

          watch(idle, async (v) => {
            if (v) {
              await tryLock()
            }
          })
        })
      },
      { immediate: true },
    )
  }

  function setupIdleMode() {
    setupIdleDetector(() => appStoreLock.getLockIdleSec)
  }

  function setupSecurityMode() {
    const isVisible = useDocumentVisibility()
    const isPageLeave = usePageLeave()

    setupIdleDetector(() => appStoreLock.getLockSecuritySec)

    debouncedWatch(isPageLeave, async (v) => {
      if (v) {
        await tryLock()
      }
    }, { debounce: 200 })

    watch(isVisible, async (v) => {
      if (!v && appStoreLock.getLockMode === AppConstLockMode.SECURITY) {
        await tryLock()
      }
    })
  }

  function setupLockMode(mode: ValueOfAppConstLockMode) {
    stopMode()

    if (mode !== AppConstLockMode.IDLE && mode !== AppConstLockMode.SECURITY) {
      return
    }

    modeScope = effectScope()
    modeScope.run(() => {
      if (mode === AppConstLockMode.IDLE) {
        setupIdleMode()
      }
      else {
        setupSecurityMode()
      }
    })
  }

  watch(
    () => appStoreLock.getEnable,
    (enabled) => {
      if (enabled) {
        lockScope = effectScope()
        lockScope.run(() => {
          appStoreLock.logicAfterLock(false)

          watch(() => appStoreLock.getLockMode, setupLockMode, { immediate: true })
        })
      }
      else {
        appStoreLock.setLocked(false)
        appStoreLock.setLockRoute({})
        stopMode()
        stopLock()
      }
    },
    { immediate: true },
  )

  tryOnUnmounted(() => {
    stopMode()
    stopLock()
  })
}
