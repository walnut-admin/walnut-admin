import type { App } from 'vue'
import type { I18n, Locale } from 'vue-i18n'
import { createI18n, useI18n } from 'vue-i18n'
import { useAppStoreLocale } from '@/store/modules/app/app-locale'

const i18n = createI18n({
  legacy: false,
  locale: {} as Locale,
  messages: {},
})

/**
 * 装 i18n 本体（同步、不会失败）。**与加载语言包分开**，是启动容错设计的一半
 * （另一半见 `src/App/src/bootstrap.ts`）：「装 i18n」是进页面的前提（组件里 `useI18n()` 要用），
 * 而「拿语言包」是一次网络请求 —— 后者失败不该把整个应用挡在 splash 上（空库时它就是会 500）。
 */
export function installI18n(app: App) {
  app.use(i18n)
}

/**
 * 拉当前语言的语言包（从后端 `/system/locale/message/:locale`，落到 i18n 实例里）。
 *
 * 本仓**没有**内置语言包兜底文件（`src/locales/` 只有这个 index）—— 语言包的唯一来源就是库。
 * 所以这一步失败时应用会以降级状态进页面：界面显示的是 i18n key，控制台/提示条会说清是这一步挂了。
 * 这比「一屏 loading 到底、原因只在控制台」可诊断得多（见 `bootstrap.ts` 顶部）。
 */
export async function loadLocaleMessages() {
  const appStoreLocale = useAppStoreLocale()
  await appStoreLocale.onLoadMessageCache(appStoreLocale.getLocale)
}

export const AppI18n = (): I18n<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Locale, false> => i18n

export const useAppI18n = () => useI18n()
