import baseConfig from '@walnut/eslint-config/base'

// 本包是「源码直消费 + 一份生成物」的形态：手写的只有 src/index.ts（re-export 与别名），
// src/schema.d.ts 是 openapi-typescript 的产物 —— `pnpm generate` 整文件重写、**不许手改**，
// 它的缩进/引号/分号是生成器的固定输出，ESLint 风格规则对它没有意义、只会在每次重新生成后
// 把 lint 打红。这里在 base 预设上追加一条全局豁免；手写文件照常全量受检。
export default baseConfig().append({
  ignores: ['src/schema.d.ts'],
})
