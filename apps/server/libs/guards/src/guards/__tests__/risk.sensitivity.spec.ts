import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { AppRoutes, AuthRoutes, SecurityRoutes, SharedRoutes, SystemEndpointRoutes, SystemRoutes } from '@walnut/contract'
import { describe, expect, it } from 'vitest'
import {
  isWalnutAdminRiskFailClose,
  resolveWalnutAdminRiskSensitivity,
  stripWalnutAdminApiVersionPrefix,
  WALNUT_ADMIN_RISK_ROUTE_SENSITIVITY,
  WALNUT_ADMIN_RISK_SENSITIVITY_FAMILIES,
  walnutAdminRiskRouteKey,
} from '../risk.sensitivity'

/**
 * 风控降级分级的三条机械闸（批次 8 / B2）。
 *
 * ## 为什么要有「扫描对账」这一条
 *
 * 清单的唯一价值是「新增敏感端点必须**显式**归类」。如果只靠人读，新增一条
 * `/auth/xxx/login` 会被默认 fail-open 静默吞掉 —— 那正是本批要修的 bug 的形态。
 * 这里用纯 fs + 正则（零装载，与 `common/monorepo/route-catalog.drift.spec.ts` 同款手法）
 * 扫出 `/auth/**` 与 `/security/**` 的**全部**路由，与清单逐条对账：
 *
 * a) 扫到的每条路由都必须在清单里（缺失即 red，报错直接给出 `METHOD path`）；
 * b) 清单里每条 fail-close 都必须是真实路由（防「清单里躺着一个已删端点」）；
 * c) fail-close 集合被逐条钉死（改分级必须同时改本文件 —— 刻意的双重确认）。
 *
 * 扫描器的已知边界：复合装饰器（`WalnutCrudDecorators` 生成的 list/read/...）看不见 ——
 * 但它们在 `/auth`、`/security` 家族里**不存在**，且 (d) 断言「家族内的 controller 不得使用
 * 复合路由装饰器」，将来有人这么写会立刻 red 而不是静默漏。
 */

// ─── 契约分组解析（`Group.KEY` → 值）──────────────────────────────────────────

const CONTRACT_GROUPS: Record<string, Record<string, string>> = {
  AppRoutes,
  AuthRoutes,
  SecurityRoutes,
  SharedRoutes,
  SystemEndpointRoutes,
  SystemRoutes,
}

// ─── 文本工具（纯文本、零装载）────────────────────────────────────────────────

/** 剥离 `//` 行注释与块注释（字符串内部原样保留）—— 注释掉的旧路由不能参与对账 */
function stripComments(text: string): string {
  let stripped = ''
  let quote: string | null = null

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (quote !== null) {
      stripped += char
      if (char === '\\') {
        stripped += text[++i] ?? ''
        continue
      }
      if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      stripped += char
      continue
    }

    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        i++
      }
      stripped += '\n'
      continue
    }

    if (char === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        i++
      }
      i++
      stripped += ' '
      continue
    }

    stripped += char
  }

  return stripped
}

function findMatchingParen(text: string, openParenIndex: number): number {
  let depth = 0
  let quote: string | null = null

  for (let i = openParenIndex; i < text.length; i++) {
    const char = text[i]

    if (quote !== null) {
      if (char === '\\') {
        i++
      }
      else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      continue
    }

    if (char === '(') {
      depth++
      continue
    }

    if (char === ')') {
      depth--
      if (depth === 0) {
        return i
      }
    }
  }

  throw new Error('装饰器括号不配对（扫描器输入被截断？）')
}

/** 读装饰器第一参：字符串字面量或 `Group.KEY` 常量引用；无参返回 undefined */
function readPathArgument(raw: string): string | undefined {
  const text = raw.trim()

  if (text === '') {
    return undefined
  }

  const literal = /^(['"])(.*?)\1/.exec(text)
  if (literal !== null) {
    return literal[2]
  }

  const reference = /^([A-Za-z_$][\w$]*)\.([A-Z][A-Z0-9_]*)/.exec(text)
  if (reference === null) {
    throw new Error(`路径既不是字面量也不是 Group.KEY 引用：${text.slice(0, 60)}（请扩展扫描器而不是绕过）`)
  }

  const value = CONTRACT_GROUPS[reference[1]]?.[reference[2]]
  if (value === undefined) {
    throw new Error(`contract 里没有 ${reference[1]}.${reference[2]}（拼错 / 分组名写错？）`)
  }

  return value
}

/** 解析装饰器实参里的路径（只取第一参；options 与路径无关） */
function readDecoratorPath(argumentSource: string): string | undefined {
  const firstArgument = argumentSource.split(/,(?![^()]*\))/)[0] ?? ''
  return readPathArgument(firstArgument)
}

/** Nest `RoutePathFactory` 的拼接规则：`stripEndSlash(a) + addLeadingSlash(b)` */
function nestJoinPath(prefix: string, methodPath: string): string {
  const stripEndSlash = (path: string): string => (path.endsWith('/') ? path.slice(0, -1) : path)
  const addLeadingSlash = (path: string): string => {
    if (path === '') {
      return ''
    }
    return path.startsWith('/') ? path : `/${path}`
  }

  let joined = ''
  if (prefix !== '') {
    joined = stripEndSlash(joined) + addLeadingSlash(prefix)
  }
  if (methodPath !== '') {
    joined = stripEndSlash(joined) + addLeadingSlash(methodPath)
  }

  const withLeading = addLeadingSlash(joined === '' ? '/' : joined)
  return withLeading === '/' ? withLeading : stripEndSlash(withLeading)
}
// ─── controller 扫描（纯 fs + 正则，零装载）──────────────────────────────────────

/** Nest 的 `@Sse` 是 GET 语义的长连接（OAuth 登录结果投递），按 GET 归类 */
const ROUTE_DECORATORS: Record<string, string> = {
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Patch: 'PATCH',
  Delete: 'DELETE',
  Options: 'GET',
  Head: 'GET',
  All: 'GET',
  Sse: 'GET',
}

/** 复合路由装饰器：路由由库里的 applyDecorators 生成，controller 源文件里没有字面量可扫 */
const COMPOSITE_ROUTE_HELPERS = ['WalnutCrudDecorators', 'WalnutAdminDecoratorCreate', 'WalnutAdminDecoratorRead', 'WalnutAdminDecoratorUpdate', 'WalnutAdminDecoratorDelete', 'WalnutAdminDecoratorDeleteMany', 'WalnutAdminDecoratorList'] as const

interface IScannedRoute {
  file: string
  method: string
  path: string
}

function listControllerFiles(dir: string): string[] {
  const found: string[] = []
  if (!existsSync(dir)) {
    return found
  }

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...listControllerFiles(full))
    }
    else if (entry.isFile() && entry.name.endsWith('.controller.ts')) {
      found.push(full)
    }
  }

  return found
}

/** 扫描面：app 侧 modules + 全部 lib 的 `src`（新增 lib 自动纳入，不维护清单） */
function listAllControllerFiles(): string[] {
  const appFiles = listControllerFiles(resolve(process.cwd(), 'apps/api/src'))
  const libsRoot = resolve(process.cwd(), 'libs')
  const libFiles = readdirSync(libsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => listControllerFiles(join(libsRoot, entry.name, 'src')))

  return [...appFiles, ...libFiles].sort()
}

function isInSensitivityFamily(path: string): boolean {
  return WALNUT_ADMIN_RISK_SENSITIVITY_FAMILIES.some(family => path === family || path.startsWith(`${family}/`))
}

function scanController(file: string): { routes: IScannedRoute[], compositeHelpers: string[] } {
  const label = relative(process.cwd(), file).split(sep).join('/')
  const text = stripComments(readFileSync(file, 'utf8'))

  const controllerMatches = [...text.matchAll(/@Controller\s*\(/g)]
  if (controllerMatches.length !== 1) {
    throw new Error(`${label}: 应恰有 1 个 @Controller（实际 ${controllerMatches.length} 个）`)
  }

  const controllerOpen = (controllerMatches[0].index ?? 0) + controllerMatches[0][0].length - 1
  const controllerClose = findMatchingParen(text, controllerOpen)
  const prefix = readDecoratorPath(text.slice(controllerOpen + 1, controllerClose)) ?? ''

  const routePattern = new RegExp(`@(${Object.keys(ROUTE_DECORATORS).join('|')})\\s*\\(`, 'g')
  const routes: IScannedRoute[] = []

  for (const routeMatch of text.matchAll(routePattern)) {
    const openParen = (routeMatch.index ?? 0) + routeMatch[0].length - 1
    const closeParen = findMatchingParen(text, openParen)
    const methodPath = readDecoratorPath(text.slice(openParen + 1, closeParen)) ?? ''
    const method = ROUTE_DECORATORS[routeMatch[1]]

    routes.push({
      file: label,
      method,
      path: nestJoinPath(prefix, methodPath),
    })
  }

  const compositeHelpers = COMPOSITE_ROUTE_HELPERS.filter(helper => text.includes(`${helper}(`))

  return { routes, compositeHelpers }
}

function scanAllRoutes(): IScannedRoute[] {
  return listAllControllerFiles().flatMap(file => scanController(file).routes)
}

// ─── 归一化器（纯函数）────────────────────────────────────────────────────────

describe('全局前缀归一化（URI versioning）', () => {
  it('去掉 /<prefix>/v<version> 与 /v<version> 两种形态', () => {
    expect(stripWalnutAdminApiVersionPrefix('/w/v1/auth/refresh')).toBe('/auth/refresh')
    expect(stripWalnutAdminApiVersionPrefix('/v1/auth/refresh')).toBe('/auth/refresh')
    expect(stripWalnutAdminApiVersionPrefix('/api/w/v1/auth/refresh')).toBe('/auth/refresh')
    expect(stripWalnutAdminApiVersionPrefix('/auth/refresh')).toBe('/auth/refresh')
  })

  it('不误伤带版本样式的业务段（前缀只在最前面剥一次）', () => {
    expect(stripWalnutAdminApiVersionPrefix('/w/v1/system/locale/message/v2')).toBe('/system/locale/message/v2')
  })
})

describe('敏感度解析', () => {
  it('fail-close：登录 / 注册 / 重置口令 / OTP·MFA 校验 / 签发·刷新凭据 / sign 握手', () => {
    const failClose = [
      ['POST', '/auth/refresh'],
      ['POST', '/auth/opaque/user/login/start'],
      ['POST', '/auth/opaque/user/login/finish'],
      ['POST', '/auth/opaque/user/register/start'],
      ['POST', '/auth/opaque/user/register/finish'],
      ['POST', '/auth/opaque/user/change-password/start'],
      ['POST', '/auth/opaque/user/change-password/finish'],
      ['POST', '/auth/opaque/admin/password/update/start'],
      ['POST', '/auth/opaque/admin/password/update/finish'],
      ['POST', '/auth/opaque/admin/password/clear'],
      ['POST', '/auth/otp/verify'],
      ['POST', '/auth/mfa/verify'],
      ['POST', '/auth/google'],
      ['GET', '/auth/oauth/github/callback'],
      ['GET', '/auth/oauth/gitee/callback'],
      ['POST', '/security/sign/initial'],
      ['POST', '/security/sign/aes-key'],
    ] as const

    for (const [method, path] of failClose) {
      expect(isWalnutAdminRiskFailClose(method, path), `${method} ${path}`).toBe(true)
      // 带全局前缀也必须命中（运行期 request.path 就是这个形态）
      expect(isWalnutAdminRiskFailClose(method, `/w/v1${path}`), `${method} /w/v1${path}`).toBe(true)
    }
  })

  it('fail-open：登出 / 读权限 / 语言包 / 心跳 / cap 解法入口', () => {
    const failOpen = [
      ['POST', '/auth/signout'],
      ['GET', '/auth/permissions'],
      ['POST', '/auth/otp/send'],
      ['POST', '/security/cap/challenge'],
      ['GET', '/security/rsa/public-key'],
      ['GET', '/system/locale/message/zh_CN'],
      ['POST', '/app/monitor/user/state'],
      ['GET', '/app/monitor/server/cpu'],
    ] as const

    for (const [method, path] of failOpen) {
      expect(isWalnutAdminRiskFailClose(method, path), `${method} ${path}`).toBe(false)
    }
  })

  it('表内带参路由能匹配具体路径（OAuth SSE 的 :fp）', () => {
    const resolved = resolveWalnutAdminRiskSensitivity('GET', '/w/v1/auth/oauth/github/sse/abc123def')

    expect(resolved?.path).toBe('/auth/oauth/github/sse/:fp')
    expect(resolved?.sensitivity).toBe('fail-open')
  })

  it('谓词不同即不同端点（GET /auth/refresh 未登记 ⇒ 非敏感）', () => {
    expect(isWalnutAdminRiskFailClose('GET', '/auth/refresh')).toBe(false)
    expect(isWalnutAdminRiskFailClose('post', '/auth/refresh')).toBe(true)
  })

  it('routeKey 稳定（日志 / 报错用的形态，恒去前缀 + 大写谓词）', () => {
    expect(walnutAdminRiskRouteKey('post', '/w/v1/auth/refresh')).toBe('POST /auth/refresh')
  })
})
// ─── 对账闸（新增敏感端点必须显式归类）────────────────────────────────────────

describe('敏感端点清单 ↔ 真实路由对账（新增端点必须显式归类）', () => {
  const scanned = scanAllRoutes()
  const familyRoutes = scanned.filter(route => isInSensitivityFamily(route.path))
  const tableKeys = new Set(WALNUT_ADMIN_RISK_ROUTE_SENSITIVITY.map(entry => `${entry.method} ${entry.path}`))

  it('扫描器真的扫到了两个家族的路由（防空扫描导致的假绿）', () => {
    expect(familyRoutes.length).toBeGreaterThan(20)
    // 抽查：登录链起点与 sign 握手都在扫描结果里
    const keys = new Set(familyRoutes.map(route => `${route.method} ${route.path}`))
    expect(keys.has('POST /auth/opaque/user/login/start')).toBe(true)
    expect(keys.has('POST /security/sign/initial')).toBe(true)
    expect(keys.has('GET /auth/oauth/github/sse/:fp')).toBe(true)
  })

  it('a) /auth/** 与 /security/** 的每条真实路由都在清单里（显式归类）', () => {
    const unclassified = familyRoutes
      .filter(route => !tableKeys.has(`${route.method} ${route.path}`))
      .map(route => `${route.method} ${route.path}  (${route.file})`)

    expect(
      unclassified,
      `新增 /auth 或 /security 端点必须在 libs/guards/src/guards/risk.sensitivity.ts 里显式归类：\n${unclassified.join('\n')}`,
    ).toEqual([])
  })

  it('b) 清单里每条 fail-close 都是真实路由（防「清单里躺着一个已删端点」）', () => {
    const scannedKeys = new Set(scanned.map(route => `${route.method} ${route.path}`))
    const stale = WALNUT_ADMIN_RISK_ROUTE_SENSITIVITY
      .filter(entry => entry.sensitivity === 'fail-close')
      .map(entry => `${entry.method} ${entry.path}`)
      .filter(key => !scannedKeys.has(key))

    expect(stale, `清单里的 fail-close 端点已不存在：\n${stale.join('\n')}`).toEqual([])
  })

  it('c) fail-close 集合被逐条钉死（改分级必须同时改本断言）', () => {
    const failClose = WALNUT_ADMIN_RISK_ROUTE_SENSITIVITY
      .filter(entry => entry.sensitivity === 'fail-close')
      .map(entry => `${entry.method} ${entry.path}`)
      .sort()

    expect(failClose).toEqual([
      'GET /auth/oauth/gitee/callback',
      'GET /auth/oauth/github/callback',
      'POST /auth/google',
      'POST /auth/mfa/verify',
      'POST /auth/opaque/admin/password/clear',
      'POST /auth/opaque/admin/password/update/finish',
      'POST /auth/opaque/admin/password/update/start',
      'POST /auth/opaque/user/change-password/finish',
      'POST /auth/opaque/user/change-password/start',
      'POST /auth/opaque/user/login/finish',
      'POST /auth/opaque/user/login/start',
      'POST /auth/opaque/user/register/finish',
      'POST /auth/opaque/user/register/start',
      'POST /auth/otp/verify',
      'POST /auth/refresh',
      'POST /security/sign/aes-key',
      'POST /security/sign/initial',
    ])
  })

  it('d) 家族内的 controller 不得使用复合路由装饰器（否则扫描器会静默漏路由）', () => {
    const offenders = listAllControllerFiles()
      .map(file => ({ file, ...scanController(file) }))
      .filter(entry => entry.routes.some(route => isInSensitivityFamily(route.path)) && entry.compositeHelpers.length > 0)
      .map(entry => `${entry.file}: ${entry.compositeHelpers.join(', ')}`)

    expect(
      offenders,
      `这些 controller 在 /auth 或 /security 家族里用了复合路由装饰器，路由对账会失真：\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('清单里没有重复键（同 method+path 只能有一条分级）', () => {
    expect(tableKeys.size).toBe(WALNUT_ADMIN_RISK_ROUTE_SENSITIVITY.length)
  })
})
