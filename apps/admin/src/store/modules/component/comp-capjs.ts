import type { IStoreComp } from '@/store/types'
import { useScriptTag } from '@vueuse/core'
import { defineStore } from 'pinia'
import { getCurrentInstance } from 'vue'
import { securityCapApiEndpoint } from '@/api/security/cap'
import { useAppEnvProxy } from '@/hooks/app/useAppEnv'
import { StoreKeys } from '../../constant'
import { store } from '../../pinia'

// LINK: apps/docs/src/zh-CN/content/shared/capjs.md
//
// cap-widget 在 **blob: worker** 里 `import(wasmUrl)` —— blob 基址下相对路径解析不了，
// URL 必须是**绝对地址**；同源即可（跨域才需要 CORS）。所以拼接 `location.origin`。
//
// 资产自托管在 `public/vendor/cap/`（2026-11-25，格式对齐 `public/vendor/tinymce`：
// 站点根相对路径，不走 VITE_PUBLIC_PATH —— 各环境都是 '/'）。glue（`cap_wasm.js`）内部按
// `new URL('cap_wasm_bg.wasm', import.meta.url)` 取同目录兄弟文件，**升级时两个文件必须一起换**，
// 详见 `apps/admin/public/vendor/cap/README.md`。
const CAP_WASM_PATH = '/vendor/cap/cap_wasm.js'

const useStoreCompCapJSInside = defineStore(StoreKeys.COMP_CAPJS, {
  state: (): IStoreComp.CapJS => ({
    elementId: 'walnut-admin-cap',
    loading: false,
    inst: null,
    show: false,
    onSuccess: null,
  }),

  getters: {
    getShow(state) {
      return state.show
    },
    getElementId(state) {
      return state.elementId!
    },
  },

  actions: {
    loadCap(): Promise<ICapInst> {
      if (this.inst) return new Promise((resolve) => resolve(this.inst!))

      const { httpUrl } = useAppEnvProxy()

      window.CAP_CUSTOM_WASM_URL = `${location.origin}${CAP_WASM_PATH}`
      return new Promise((resolve) => {
        useScriptTag(`${httpUrl}/static/js/cap/widget@0.1.25.js`, () => {
          this.inst = window.Cap
          resolve(this.inst)
        })
      })
    },

    async refreshCapJSToken() {
      this.loading = true
      try {
        const CapInst = await this.loadCap()
        const cap = new CapInst(
          {
            apiEndpoint: securityCapApiEndpoint,
          },
          document.getElementById(this.getElementId)!,
        )
        const { token } = await cap.solve()
        return token
      } catch (e) {
        console.error('refresh cap js token failed', e)
        return ''
      } finally {
        this.loading = false
      }
    },

    async onOpenCapModal<T>(onSuccess: (token: string) => Promise<T>): Promise<T> {
      await this.loadCap()
      this.show = true

      return new Promise<T>((resolve, reject) => {
        this.onSuccess = async (token: string) => {
          try {
            const result = await onSuccess(token)
            resolve(result)
          } catch (e) {
            reject(e)
          } finally {
            this.show = false
            this.onSuccess = null
          }
        }
      })
    },

    onCloseCapModal() {
      this.show = false
      this.onSuccess = null
    },
  },
})

const useStoreCompCapJSOutside = () => useStoreCompCapJSInside(store)

export function useStoreCompCapJS() {
  if (getCurrentInstance()) return useStoreCompCapJSInside()
  return useStoreCompCapJSOutside()
}
