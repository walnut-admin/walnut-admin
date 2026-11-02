import type { Linter } from 'eslint'
import nestConfig, { DATA_SCOPE_DIRECT_REPOSITORY_MESSAGE, DATA_SCOPE_DIRECT_REPOSITORY_SELECTOR } from '@walnut/eslint-config/nest'

// ── lib 分层门禁 ───────────────────────────────────────────────────────────────
// 依赖方向（箭头指向被依赖方，只有上层 import 下层）：
//   基建 < 技术设施 < 技术装配 < identity < system < auth < security < guards < app-domain
// 判定式：rank(target) <= rank(source)；唯一例外 exceptions -> blpath。
// no-restricted-imports 是 core 规则，不需要类型信息。
const INFRA_LIBS = ['config', 'const', 'context', 'db', 'decorators', 'pipes', 'types', 'utils'] as const

// exceptions 是基建层里唯一有外向例外（-> blpath）的 lib：单独一条精确 layer，
// 不并入 INFRA_LIBS —— 接线对账要求每个 lib 恰好登记进一个 layer 的 libs 数组。
const EXCEPTION_LIBS = ['exceptions'] as const

// 技术层拆两条（F-14 / Q8a）：tech-base 是「纯技术设施」（不感知域与数据面），
// tech-assemble 是「跨域装配内核」（repository / list / crud / scope-resolver / token）。
// 允许边只有 assemble → base **单向**：base 反过来引内核就是环的起点（ip 原引 crud 的
// 端口 token 即此类，按 Decision 3 把 token 迁回 libs/ip 后方向变正），由 banned 按
// rank 自动收紧拦住（不需要逐条边清单）。
const TECH_BASE_LIBS = ['als', 'blpath', 'cookie', 'crypto', 'delay', 'lock', 'queue', 'sse', 'cache', 'throttle', 'mailer', 'sms', 'rsa', 'ip'] as const

const TECH_ASSEMBLE_LIBS = ['repository', 'list', 'crud', 'scope-resolver', 'token'] as const

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
          message: '该 lib 尚未登记分层。请先在 eslint.config.ts 的 INFRA_LIBS / TECH_BASE_LIBS / TECH_ASSEMBLE_LIBS / 领域层列表中归类。',
        },
      ],
    }],
  },
}

// libs 专属的两条守卫（只对 libs/** 生效）：
// 1. 相对路径跨 lib 逃逸（`import '../../system/src/...'` / `export ... from`）走本地规则；
//    分层 no-restricted-imports 只匹配 `@walnut-server/*` 别名，相对路径是它的盲区。
// 2. libs 内**零动态 import**：ImportExpression 的 source 可以是模板串 / 拼接 / 变量，静态分层
//    门禁（no-restricted-imports 与上面的本地规则）对它们全部失效；今天 libs 下没有任何运行时
//    动态 import，所以按零豁免口径全禁，确需按需加载时在评审中显式豁免。类型位的 `import('x')`
//    （`typeof import('x')`）是 TSImportType 节点、不产生运行时依赖边，不在本 selector 内。
// flat config 同一 rules key 后份覆盖前份：这里的 no-restricted-syntax 必须带上 nest 预设的
// 数据权限 selector，否则 libs 里已有的显式 disable 会变成未使用指令、直连保护静默消失。
const libsGuardConfig: Linter.Config = {
  name: 'walnut/server/libs-guard',
  files: ['libs/**/*.ts'],
  rules: {
    'local/no-cross-lib-relative-import': 'error',
    'no-restricted-syntax': ['error', {
      selector: 'ImportExpression',
      message: 'libs 内禁止动态 import（含模板串/拼接/类型位 import()，现有静态门禁对它们全部失效）；确需按需加载时在评审中显式豁免。',
    }, {
      selector: DATA_SCOPE_DIRECT_REPOSITORY_SELECTOR,
      message: DATA_SCOPE_DIRECT_REPOSITORY_MESSAGE,
    }],
  },
}

export default nestConfig().append(
  libsBoundaryConfig,
  libsGuardConfig,
  layer('infra', INFRA_LIBS, [...TECH_BASE_LIBS, ...TECH_ASSEMBLE_LIBS, ...DOMAIN_LIBS, ...TOP_LIBS], '基建层'),
  // 唯一例外：异常过滤器需要 blpath 的 skip 名单（blpath 零出边）。
  layer('infra-exceptions', EXCEPTION_LIBS, [...TECH_BASE_LIBS.filter(lib => lib !== 'blpath'), ...TECH_ASSEMBLE_LIBS, ...DOMAIN_LIBS, ...TOP_LIBS], '基建层（exceptions 例外）'),
  // 技术设施（base）不能被内核（assemble）依赖 —— banned 里含 assemble 即 mechanical 拦下；
  // 反过来 assemble 引 base 合法（不在其 banned 内）。
  layer('tech-base', TECH_BASE_LIBS, [...TECH_ASSEMBLE_LIBS, ...DOMAIN_LIBS, ...TOP_LIBS], '技术设施层'),
  layer('tech-assemble', TECH_ASSEMBLE_LIBS, [...DOMAIN_LIBS, ...TOP_LIBS], '技术装配层'),
  layer('identity', ['identity'], [...DOMAIN_LIBS.filter(lib => lib !== 'identity'), ...TOP_LIBS], 'identity 内核'),
  layer('system', ['system'], ['auth', 'security', ...TOP_LIBS], 'system 域'),
  layer('auth', ['auth'], ['security', ...TOP_LIBS], 'auth 域'),
  layer('security', ['security'], TOP_LIBS, 'security 域'),
  layer('guards', ['guards'], ['app-domain'], 'guards 装配层'),
  layer('app-domain', ['app-domain'], [], 'app-domain 顶层'),
)
