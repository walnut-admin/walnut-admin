// Re-exported from @walnut/client — single source of truth
// 只保留仓内实际消费的两个符号；Cookie / removeCookie 在 client 侧的公共导出仍在
// （那边是包的公共面），admin 不再转发无人使用的入口。
export { getCookie, setCookie } from '@walnut/client/browser/cookie'
