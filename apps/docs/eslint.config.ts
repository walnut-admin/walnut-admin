import vueConfig from '@walnut/eslint-config/vue'

export default vueConfig({
  ignores: ['**/node_modules/**', '**/dist/**', '.vitepress/cache/**', '.vitepress/dist/**'],
  // 两条规则要写在**各自插件的 `overrides`** 里，不能写在顶层 `rules`：
  // `@antfu/eslint-config@8` 的 `OptionsConfig` **没有**顶层 `rules`（类型里没有；运行时却认，
  // 因为工厂把未知键直接展开进了 config 对象）—— 顶层写会 TS2353。改成按插件写是官方签名，
  // 且最终 config 与原来逐项一致（`eslint --print-config` 核过：两条都是 severity 1）。
  vue: { overrides: { 'vue/no-unused-refs': 'warn' } },
  imports: { overrides: { 'import/newline-after-import': 'warn' } },
})
