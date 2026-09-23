import baseConfig from '@walnut/eslint-config/base'

// 根级只有「由工具加载的配置」：`*.ts` / `*.json` / `*.yaml`，没有 `.vue` —— 因此用 base 预设
// 而不是 vue 预设（后者只多出 vue / unocss 插件，对根级文件是空转）。
//
// ⚠️ 这个文件的作用域**不止根目录**：仓内只有 5 份 `eslint.config.ts`（根 + 3 个 app + ui），
// 其余 10 个包（`platform-any/*`、`platform-web/{client,http}`、`tooling/*`）没有自己的配置，
// ESLint 会向上查到本文件 —— 它们全是 TS-only，base 正是它们该用的预设。
// 这 10 个包的 `lint` 脚本输出因此也由本文件决定，改这里等于改它们的 lint 行为。
export default baseConfig()
