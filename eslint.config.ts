import baseConfig from '@walnut/eslint-config/base'

// 根级只有「由工具加载的配置」：`*.ts` / `*.json` / `*.yaml`，没有 `.vue` —— 因此用 base 预设
// 而不是 vue 预设（后者只多出 vue / unocss 插件，对根级文件是空转）。
//
// 这个文件的作用域**不止根目录**：大多数包没有自己的 `eslint.config.ts`，ESLint 会向上
// 查到本文件 —— 它们全是 TS-only，base 正是它们该用的预设。自带配置的例外都有理由：
// apps/{admin,docs} 用 vue 预设、apps/server 用 nest 预设、apps/e2e 与 api-types 用 base +
// 各自的 `ignores`（e2e 排运行态产物；api-types 豁免生成物 `src/schema.d.ts`，理由见各文件顶部注释）。
// 这类包的 `lint` 脚本输出由各自的配置决定；没有配置的包改这里等于改它们的 lint 行为。
export default baseConfig()
