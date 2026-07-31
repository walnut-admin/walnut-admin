import type { Pinia } from 'pinia'
import { defineStore } from 'pinia'
import { getCurrentInstance } from 'vue'

/**
 * Creates a Walnut Admin Pinia store with instance-aware accessor.
 *
 * This eliminates the ~10-line boilerplate repeated in 24+ store files.
 * The returned function works both inside Vue setup (returns the store directly
 * via getCurrentInstance) and outside (uses the shared Pinia instance).
 *
 * @example
 * ```ts
 * export const useAppStoreApp = createWalnutStore(StoreKeys.APP, storeInstance, () => {
 *   const collapsed = ref(false)
 *   return { collapsed }
 * })
 * ```
 */
export function createWalnutStore<T extends object>(
  storeKey: string,
  piniaInstance: Pinia,
  setup: () => T,
) {
  const useInside = defineStore(storeKey, setup)

  const useOutside = () => useInside(piniaInstance)

  return function useStore() {
    if (getCurrentInstance())
      return useInside()
    return useOutside()
  }
}
