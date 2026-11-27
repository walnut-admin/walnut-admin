import { resolve } from 'node:path'
import { defineConfig } from 'tsdown'

/**
 * 包入口 + 19 个公共模块，键名必须与 `src/<x>.ts` 文件名逐字一致。
 *
 * 这三处此前全靠人工同步（entries ⇄ `src/index.ts` barrel ⇄ `package.json` exports），
 * 漏登记的症状是**静默**的（dist 少产物 / 子路径 import 404 / barrel 少一个值）。
 * `__tests__/entries.drift.test.ts` 用文本解析本文件把缺口变成红测试 —— 改这张表后跑它。
 */
const entries = {
  index: resolve(import.meta.dirname, 'src/index.ts'),
  cookie: resolve(import.meta.dirname, 'src/cookie.ts'),
  'crypto-wire': resolve(import.meta.dirname, 'src/crypto-wire.ts'),
  'data-scope': resolve(import.meta.dirname, 'src/data-scope.ts'),
  http: resolve(import.meta.dirname, 'src/http.ts'),
  i18n: resolve(import.meta.dirname, 'src/i18n.ts'),
  menu: resolve(import.meta.dirname, 'src/menu.ts'),
  mfa: resolve(import.meta.dirname, 'src/mfa.ts'),
  pagination: resolve(import.meta.dirname, 'src/pagination.ts'),
  preference: resolve(import.meta.dirname, 'src/preference.ts'),
  response: resolve(import.meta.dirname, 'src/response.ts'),
  'response-code': resolve(import.meta.dirname, 'src/response-code.ts'),
  role: resolve(import.meta.dirname, 'src/role.ts'),
  routes: resolve(import.meta.dirname, 'src/routes.ts'),
  setting: resolve(import.meta.dirname, 'src/setting.ts'),
  socket: resolve(import.meta.dirname, 'src/socket.ts'),
  sse: resolve(import.meta.dirname, 'src/sse.ts'),
  token: resolve(import.meta.dirname, 'src/token.ts'),
  'token-key': resolve(import.meta.dirname, 'src/token-key.ts'),
  'user-lock': resolve(import.meta.dirname, 'src/user-lock.ts'),
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
  // `easy-fns-ts` 是唯一的外部运行时依赖，保持 external（不内联进产物）
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
