import type { Linter } from 'eslint'
import nestConfig from '@walnut/eslint-config/nest'

// ── lib 分层门禁 ───────────────────────────────────────────────────────────────
// 依赖方向（箭头指向被依赖方，只有上层 import 下层）：
//   基建 < 技术 < identity < system < auth < security < guards < app-domain
// 判定式：rank(target) <= rank(source)；唯一例外 exceptions -> blpath。
// no-restricted-imports 是 core 规则，不需要类型信息。
const INFRA_LIBS = ['config', 'const', 'context', 'db', 'decorators', 'exceptions', 'pipes', 'types', 'utils'] as const

const TECH_LIBS = ['als', 'blpath', 'cookie', 'crypto', 'delay', 'lock', 'queue', 'sse', 'cache', 'throttle', 'mailer', 'sms', 'rsa', 'ip', 'repository', 'list', 'crud', 'scope-resolver', 'token'] as const

const DOMAIN_LIBS = ['identity', 'system', 'auth', 'security'] as const
const TOP_LIBS = ['guards', 'app-domain'] as const

// 公共禁令：平台边界 + app 边界。flat config 同规则后份配置整体覆盖前份，
// 每条 libs 配置都必须带上这组，否则会静默丢掉预设的 @walnut/client / @walnut/http。
const COMMON_IMPORT_PATTERNS = [
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
]

function banned(libs: readonly string[], layer: string) {
  return {
    group: libs.flatMap(lib => [`@walnut-server/${lib}`, `@walnut-server/${lib}/*`]),
    message: `lib 分层门禁：${layer} 不能 import ${libs.join(' / ')}。依赖方向见 ADR 0022。`,
  }
}

function layer(name: string, libs: readonly string[], bannedLibs: readonly string[], layerLabel: string): Linter.Config {
  return {
    name: `walnut/server/layer-${name}`,
    files: libs.map(lib => `libs/${lib}/**/*.ts`),
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          ...COMMON_IMPORT_PATTERNS,
          ...(bannedLibs.length ? [banned(bannedLibs, layerLabel)] : []),
        ],
      }],
    },
  }
}

// 未登记分层的 lib：禁止 import 任何 @walnut-server/*（fail-closed）。
// 新增 lib 的出边会先红，迫使把它归入下面的层列表。
const libsBoundaryConfig: Linter.Config = {
  name: 'walnut/server/libs-boundary',
  files: ['libs/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        ...COMMON_IMPORT_PATTERNS,
        {
          group: ['@walnut-server/*'],
          message: '该 lib 尚未登记分层。请先在 eslint.config.ts 的 INFRA_LIBS / TECH_LIBS / 领域层列表中归类。',
        },
      ],
    }],
  },
}

export default nestConfig().append(
  libsBoundaryConfig,
  layer('infra', INFRA_LIBS, [...TECH_LIBS, ...DOMAIN_LIBS, ...TOP_LIBS], '基建层'),
  // 唯一例外：异常过滤器需要 blpath 的 skip 名单（blpath 零出边）。
  layer('infra-exceptions', ['exceptions'], [...TECH_LIBS.filter(lib => lib !== 'blpath'), ...DOMAIN_LIBS, ...TOP_LIBS], '基建层（exceptions 例外）'),
  layer('tech', TECH_LIBS, [...DOMAIN_LIBS, ...TOP_LIBS], '技术层'),
  layer('identity', ['identity'], [...DOMAIN_LIBS.filter(lib => lib !== 'identity'), ...TOP_LIBS], 'identity 内核'),
  layer('system', ['system'], ['auth', 'security', ...TOP_LIBS], 'system 域'),
  layer('auth', ['auth'], ['security', ...TOP_LIBS], 'auth 域'),
  layer('security', ['security'], TOP_LIBS, 'security 域'),
  layer('guards', ['guards'], ['app-domain'], 'guards 装配层'),
  layer('app-domain', ['app-domain'], [], 'app-domain 顶层'),
)
