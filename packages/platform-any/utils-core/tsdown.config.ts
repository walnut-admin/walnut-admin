import { resolve } from 'node:path'
import { defineConfig } from 'tsdown'

/**
 * 只构建**双端同源**的两个子路径 + 包入口（D7 之后）。
 * 别的工具不要去 client 那边复制进来 —— 后端的 CJS 消费面只有 `dist/object-paths.cjs`
 * 与 `dist/sign-raw.cjs`（`apps/server` 的 guards 与 `libs/utils` 各 require 其一）。
 */
const entries = {
  index: resolve(import.meta.dirname, 'src/index.ts'),
  'object-paths': resolve(import.meta.dirname, 'src/object-paths.ts'),
  'sign-raw': resolve(import.meta.dirname, 'src/sign-raw.ts'),
}

export default defineConfig({
  entry: entries,
  // 只产 CJS，与现状一致；后端 require 是既成事实
  format: ['cjs'],
  sourcemap: true,
  clean: true,
  // CJS 产物**不要开 minify**：压缩后的 re-export 对 cjs-module-lexer 不可见，
  // ESM 侧具名导入会静默丢失
  minify: false,
  // types 指源码、dist 的 d.ts 无消费者 ⇒ 关掉，同时绕开 rolldown-plugin-dts 的坑
  dts: false,
  // exports 五条件的形状生成器表达不了 ⇒ 手写不动，关掉生成
  exports: false,
  // 本包**当前零外部运行时依赖**（`src` 只 import 同包的 `./object-paths`）。这行是从 contract
  // 的配置复制来的防御项：`easy-fns-ts` 不是本包的依赖、也没被 import，写在这里是「将来引入时
  // 不内联进产物」的占位，而不是现状描述（2026-11-28 订正：旧注释称它是「唯一的外部运行时依赖」，
  // 与 package.json / src 的实际情况不符）。
  deps: { neverBundle: ['easy-fns-ts'] },
  outputOptions: {
    exports: 'named',
    // rolldown 默认 'if-default-prop'，纯具名导出入口不会带 __esModule，必须显式
    esModule: true,
    strict: true,
  },
  publint: false,
  attw: false,
})
