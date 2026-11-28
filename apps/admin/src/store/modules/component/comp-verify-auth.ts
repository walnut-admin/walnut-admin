import type { VerifyAuthOptions, VerifyAuthResult } from '@/components/Global/VerifyAuth/types'
import type { IStoreComp } from '@/store/types'
import { defineStore } from 'pinia'
import { getCurrentInstance } from 'vue'
import { StoreKeys } from '../../constant'
import { store } from '../../pinia'

/**
 * 全局二次验证弹窗（方法选择 → 验证码）的状态。
 *
 * **打开是带返回值的**：`onOpenVerifyAuthModal()` 返回一个在「验证成功」或「用户取消」时
 * 结清的 promise（**永不 reject** —— 取消是正常路径，拒绝会让不 await 的调用方产生
 * unhandled rejection，demo 页就是那种调用方）。40119 接线（`response/sensitiveVerify.ts`）
 * 靠它知道验证是否真的通过，再决定要不要重放原请求。
 */
const useStoreCompVerifyAuthInside = defineStore(StoreKeys.COMP_VERIFY_AUTH, {
  state: (): IStoreComp.VerifyAuth => ({
    show: false,
    options: {},
    resolvePending: null,
  }),

  getters: {
    getShow(state) {
      return state.show!
    },
    getOptions(state) {
      return state.options
    },
  },

  actions: {
    /**
     * 打开弹窗并等它结清。
     *
     * 若上一次打开还没人结清（只有绕过 40119 单例、直接调 store 的场景才会发生），
     * 先把旧的按「取消」结清 —— 否则那个 promise 永远悬着。
     */
    onOpenVerifyAuthModal(options?: VerifyAuthOptions): Promise<VerifyAuthResult> {
      this.settleVerifyAuthModal({ verified: false, trusted: false })

      this.options = options ?? {}
      this.show = true

      return new Promise<VerifyAuthResult>((resolve) => {
        this.resolvePending = resolve
      })
    },

    /** 验证成功：关闭弹窗并按结果结清 */
    onVerifiedVerifyAuthModal(result: VerifyAuthResult) {
      this.show = false
      this.settleVerifyAuthModal(result)
    },

    /** 用户取消（关掉弹窗 / 返回选择后再关）：按「未验证」结清 */
    onCloseVerifyAuthModal() {
      this.show = false
      this.settleVerifyAuthModal({ verified: false, trusted: false })
    },

    settleVerifyAuthModal(result: VerifyAuthResult) {
      const resolve = this.resolvePending
      this.resolvePending = null
      resolve?.(result)
    },
  },
})

const useStoreCompVerifyAuthOutside = () => useStoreCompVerifyAuthInside(store)

export function useStoreCompVerifyAuth() {
  if (getCurrentInstance()) return useStoreCompVerifyAuthInside()
  return useStoreCompVerifyAuthOutside()
}
