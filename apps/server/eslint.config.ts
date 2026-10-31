import nestConfig from '@walnut/eslint-config/nest'

export default nestConfig().append({
  // ── 内部 lib 边界：libs/** 禁止反向依赖 app ────────────────────────────────────
  // `@/*` 指向 apps/api/src。目标形态是「app = 组合根，libs = 可复用模块，依赖单向
  // app → libs」（libs 解耦计划）；lib import app 会让这个方向不可能成立。需要 app
  // 能力时用注入 token 反转依赖（由 app 提供实现），不许 import。
  // 注意与 nest.ts 预设里全局的 no-restricted-imports 合并：flat config 同规则在后
  // 份配置里整体覆盖，所以预设拦的 @walnut/client、@walnut/http 在 libs 下要重抄一遍。
  name: 'walnut/server/libs-boundary',
  files: ['libs/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        {
          group: ['@walnut/client', '@walnut/client/*'],
          message: '@walnut/client contains Vue composables and browser-only APIs (Web Crypto, DOM, IndexedDB). Do not import from NestJS server code.',
        },
        {
          group: ['@walnut/http', '@walnut/http/*'],
          message: '@walnut/http is the frontend HTTP client (browser interceptors, cache, retry). Server should use @nestjs/axios or raw axios.',
        },
        {
          group: ['@/*', '@/**'],
          message: '内部 lib 禁止 import @/*（那是 apps/api/src）。lib 只能依赖其他 @walnut-server/* 或三方包；需要 app 能力时用注入 token 反转依赖。',
        },
        {
          group: ['**/apps/api/**', '**/apps/**'],
          message: '内部 lib 禁止相对路径逃逸进 apps/。走 @walnut-server/* 别名，或反转依赖。',
        },
      ],
    }],
  },
})
