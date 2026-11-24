import legacy from '@vitejs/plugin-legacy'

/**
 * 旧浏览器兼容（`VITE_BUILD_LEGACY`）的目标环境有**两条独立的线**：
 *
 * - `targets`：只作用于 **legacy 产物**（Babel + SystemJS，`<script nomodule>` 才加载的老浏览器）；
 * - `modernTargets`：只作用于 **现代产物**（主 bundle）。插件用它覆盖 `build.target`。
 *
 * 为什么必须显式给 `modernTargets`：插件默认的现代目标是
 * `es2020, edge105, firefox106, chrome105, safari16.4, ios16.4`，而 esbuild 把 `es2020`
 * 当成聚合目标 —— 它低于顶层 await 所需的 ES2022，于是 admin 的
 * `src/store/modules/{app,user}` 在模块顶层 `await useAppStorageAsync(...)` 时构建直接失败：
 * `Top-level await is not available in the configured target environment`。
 *
 * 这里给的查询与插件默认的**浏览器版本集合相同**（105 / 106 / 16.4），只是让
 * browserslist-to-esbuild 解析成带版本的目标（chrome105 / firefox106 / safari16.4 …），
 * 不再落到 `es2020` —— 现代产物的浏览器下限既没放宽也没收紧。
 *
 * 取舍：若将来把 `modernTargets` 调到只含更新的浏览器，legacy 产物仍由 `targets` 覆盖老浏览器，
 * 但「支持 ESM 却不满足新 modernTargets」的那一档会落进插件文档所说的空档；调整时要同步
 * README / ADR 并把取舍写清楚。
 */
export function createLegacyPlugin() {
  return legacy({
    targets: ['last 10 versions and not dead, > 0.3%, Firefox ESR'],
    modernTargets: ['edge>=105, firefox>=106, chrome>=105, safari>=16.4, chromeAndroid>=105, iOS>=16.4'],
  })
}
