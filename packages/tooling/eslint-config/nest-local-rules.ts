import type { Rule } from 'eslint'
import { dirname, relative, resolve } from 'node:path'

/**
 * 本地 ESLint 规则集（nest 预设专用）：
 * - `sort-nestjs-decorators`：强制 NestJS 装饰器与参数的书写顺序；
 * - `no-cross-lib-relative-import`：禁止 `libs/<name>/` 内用相对路径（import 或 re-export）逃逸到
 *   另一个 lib（分层 no-restricted-imports 只匹配 `@walnut-server/*` 别名，相对路径是它的盲区）。
 *
 * 为什么自带类型而不是沿用无类型 JS：本文件是 `nest.ts` 预设的一部分，预设与它都在
 * `@walnut/eslint-config` 里，而该包现在要过 `tsc --noEmit`（此前它的 types:check 是 `echo` 空跑）。
 *
 * 类型策略：ESLint 官方的 `Rule.RuleListener` 用的是 ESTree 节点，而**装饰器**是
 * `@typescript-eslint` 的 AST 扩展（ESTree 里没有 `decorators`）。为这一处引入
 * `@typescript-eslint/utils` 只为一个规则不值得，所以在边界处用本文件自带的窄接口 + `as` 收口 ——
 * 形状不对时是运行期读不到属性（与本规则此前的行为一致），而不是静默给出错误判定。
 */

/** 装饰器节点（只声明本规则真正读到的字段） */
interface DecoratorLike {
  expression: {
    type: string
    name?: string
    callee?: { type?: string, name?: string }
  }
  range: [number, number]
  loc: { start: { line: number } }
}

/** 可挂装饰器的节点（类声明 / 方法定义 / 参数） */
interface DecoratedLike {
  decorators?: DecoratorLike[]
  range: [number, number]
  loc: { start: { line: number } }
}

/** 参数节点（可能是解构/默认值形态） */
interface ParameterLike extends DecoratedLike {
  type: string
  left?: ParameterLike
}

/** 方法定义节点 */
interface MethodLike extends DecoratedLike {
  value?: { params?: ParameterLike[] } | null
}

/** 本规则接受的可选配置 */
interface RuleOptionsLike {
  methodOrder?: string[]
  paramOrder?: string[]
  classOrder?: string[]
}

/** 带 `source` 的语句节点（`import ... from` / `export ... from`；无 source 的 export 为 null / 缺省） */
interface SourceLike {
  source?: { value?: unknown } | null
}

/** 路径统一成 posix 形态（Windows 反斜杠与 POSIX 斜杠在规则里只在比较时才一致） */
function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/')
}

/**
 * 文件所属内部 lib 根的绝对 posix 路径；不在 `<cwd>/libs/<name>/` 下时返回 null。
 *
 * 必须锚定 `resolve(cwd, 'libs')` 前缀，而不是在整条路径里找**第一个** `libs/<name>/`：
 * 检出目录自身的祖先目录若含 `libs/<name>`（如 `D:/libs/checkout/apps/server/...`），
 * 后者会把祖先误认成 lib 根，此后所有跨 lib 相对路径都落在「假 lib 根」之内而 fail-open。
 *
 * 导出仅供单测覆盖祖先目录场景（RuleTester 无法指定 `context.cwd`）。
 */
export function resolveLibRoot(cwd: string, filename: string): string | null {
  const libsRoot = toPosixPath(resolve(cwd, 'libs'))
  const absolute = toPosixPath(resolve(cwd, toPosixPath(filename)))

  const rest = absolute.startsWith(`${libsRoot}/`) ? absolute.slice(libsRoot.length + 1) : ''
  const libName = rest.split('/')[0]
  if (!libName)
    return null

  return `${libsRoot}/${libName}`
}

/** 方法装饰器顺序 */
const DEFAULT_METHOD_ORDER = [
  'Get',
  'Post',
  'Put',
  'Patch',
  'Delete',
  'HttpCode',
  'WalnutAdminDecoratorHasPermission',
  'WalnutAdminDecoratorHasRole',
  'WalnutAdminDecoratorFunctionalGuard',
  'WalnutAdminDecoratorList',
  'WalnutAdminDecoratorCreate',
  'WalnutAdminDecoratorRead',
  'WalnutAdminDecoratorUpdate',
  'WalnutAdminDecoratorDelete',
  'WalnutAdminDecoratorDeleteMany',
  'WalnutAdminGuardJwtOptional',
  'WalnutAdminGuardLockFree',
  'WalnutAdminGuardSignFree',
  'WalnutAdminGuardMFAFree',
  'WalnutAdminGuardJwtFree',
  'WalnutAdminGuardCapFree',
  'WalnutAdminGuardDeviceFree',
  'WalnutAdminGuardIpFree',
  'WalnutTx',
  'ApiExtraModels',
  'ApiParam',
  'ApiQuery',
  'ApiBody',
  'ApiWalnutOkResponse',
  'ApiOkResponse',
  'WalnutAdminDecoratorFreeResponse',
  'WalnutAdminDecoratorCache',
  'WalnutAdminDecoratorAuthLog',
  'WalnutAdminDecoratorOperateLog',
  'WalnutAdminDecoratorThrottle',
  'WalnutAdminDecoratorDevOnly',
  'Render',
  'UseGuards',
]

/** 参数装饰器顺序（用于参数排序） */
const DEFAULT_PARAM_ORDER = [
  'WalnutAdminDecoratorJti',
  'WalnutAdminDecoratorUser',
  'WalnutAdminDecoratorDeviceId',
  'WalnutTxSession',
  'WalnutAdminDecoratorCookie',
  'WalnutAdminDecoratorParamMongoId',
  'WalnutAdminDecoratorParamMongoIds',
  'Req',
  'Request',
  'Res',
  'Response',
  'Param',
  'Query',
  'Body',
  'Headers',
  'Ip',
  'I18n',
]

/** 类装饰器顺序 */
const DEFAULT_CLASS_ORDER = [
  'Controller',
  'ApiTags',
  'UseGuards',
]

const plugin: { rules: Record<string, Rule.RuleModule> } = {
  rules: {
    'sort-nestjs-decorators': {
      meta: {
        type: 'layout',
        fixable: 'code',
        docs: {
          description: 'Enforce consistent ordering of NestJS decorators',
        },
        schema: [{
          type: 'object',
          properties: {
            methodOrder: { type: 'array', items: { type: 'string' } },
            paramOrder: { type: 'array', items: { type: 'string' } },
            classOrder: { type: 'array', items: { type: 'string' } },
          },
        }],
      },

      create(context) {
        const options = (context.options[0] ?? {}) as RuleOptionsLike
        const methodOrder = options.methodOrder ?? DEFAULT_METHOD_ORDER
        const paramOrder = options.paramOrder ?? DEFAULT_PARAM_ORDER
        const classOrder = options.classOrder ?? DEFAULT_CLASS_ORDER

        function getPriority(name: string, orderArray: string[]): number {
          const index = orderArray.findIndex(prefix => name.startsWith(prefix))
          return index === -1 ? orderArray.length : index
        }

        function extractName(decorator: DecoratorLike): string {
          if (decorator.expression.type === 'CallExpression')
            return decorator.expression.callee?.name ?? ''
          if (decorator.expression.type === 'Identifier')
            return decorator.expression.name ?? ''
          return ''
        }

        /** 该节点所在行的缩进（`fix` 里拼多行文本时要用） */
        function getIndent(node: DecoratedLike): string {
          const startLine = node.loc.start.line
          if (startLine === 1)
            return ''

          const sourceCode = context.sourceCode
          const lineStart = sourceCode.getIndexFromLoc({ line: startLine, column: 0 })
          const nodeStart = node.range[0]
          const line = sourceCode.getText().substring(lineStart, nodeStart)
          return /^\s*/.exec(line)?.[0] ?? ''
        }

        function sortByPriority<T extends { name: string, idx: number }>(items: T[], orderArray: string[]): T[] {
          return [...items].sort((a, b) => {
            const priorityA = getPriority(a.name, orderArray)
            const priorityB = getPriority(b.name, orderArray)
            return priorityA !== priorityB ? priorityA - priorityB : a.idx - b.idx
          })
        }

        function handleClassOrMethodDecorators(node: DecoratedLike, orderArray: string[], nodeType: string): void {
          const decorators = node.decorators
          if (!decorators || decorators.length <= 1)
            return

          const entries = decorators.map((decorator, idx) => ({
            node: decorator,
            name: extractName(decorator),
            idx,
          }))

          const sorted = sortByPriority(entries, orderArray)
          const needsFix = entries.some((entry, index) => entry.name !== sorted[index]!.name)
          if (!needsFix)
            return

          context.report({
            // ESTree 的节点类型里没有 decorators / value 这些 TS-ESLint 扩展字段，
            // 而这里只是把真实节点交给报告器定位用 ⇒ 收口成 never（不引入 @typescript-eslint/utils）
            node: node as never,
            message: `${nodeType} decorators should be ordered according to the style guide`,
            fix(fixer) {
              const sourceCode = context.sourceCode
              const first = decorators[0]!
              const last = decorators[decorators.length - 1]!
              const indent = getIndent(first)

              const texts = sorted.map(entry => sourceCode.getText(entry.node as never))
              const newText = texts.join(`\n${indent}`)

              return fixer.replaceTextRange([first.range[0], last.range[1]], newText)
            },
          })
        }

        return {
          ClassDeclaration(node) {
            handleClassOrMethodDecorators(node as unknown as DecoratedLike, classOrder, 'Class')
          },

          MethodDefinition(node) {
            const method = node as unknown as MethodLike

            // 1. 处理方法装饰器
            handleClassOrMethodDecorators(method, methodOrder, 'Method')

            // 2. 处理参数排序
            const params = method.value?.params
            if (!params || params.length <= 1)
              return

            const entries = params.map((param, idx) => {
              // 处理解构参数
              const actualParam: ParameterLike = param.type === 'AssignmentPattern' && param.left ? param.left : param
              const decorators = actualParam.decorators ?? []

              // 获取参数的主要装饰器名称（第一个装饰器）
              const mainDecoratorName = decorators.length > 0 ? extractName(decorators[0]!) : ''

              // 计算完整范围（包括装饰器）
              const startPos = decorators.length > 0 ? decorators[0]!.range[0] : param.range[0]
              const endPos = param.range[1]

              return {
                node: actualParam,
                mainDecoratorName,
                priority: getPriority(mainDecoratorName, paramOrder),
                fullRange: [startPos, endPos] as [number, number],
                idx,
              }
            })

            // 按装饰器优先级排序
            const sorted = [...entries].sort((a, b) => {
              if (a.priority !== b.priority)
                return a.priority - b.priority
              return a.idx - b.idx
            })

            // 检查是否需要重排
            const needsFix = entries.some((entry, index) => entry.mainDecoratorName !== sorted[index]!.mainDecoratorName)
            if (!needsFix)
              return

            context.report({
              node: method.value as never,
              message: 'Parameters should be ordered by their decorator types',
              fix(fixer) {
                const sourceCode = context.sourceCode
                const firstParam = entries[0]!
                const lastParam = entries[entries.length - 1]!

                // 获取第一个参数的缩进
                const paramIndent = getIndent(firstParam.node)

                // 获取每个参数的完整文本（包括装饰器）
                const paramTexts = sorted.map(entry =>
                  sourceCode.text.substring(entry.fullRange[0], entry.fullRange[1]).trim(),
                )

                // 用换行和缩进连接参数
                const newParamsText = paramTexts.join(`,\n${paramIndent}`)

                return fixer.replaceTextRange(
                  [firstParam.fullRange[0], lastParam.fullRange[1]],
                  newParamsText,
                )
              },
            })
          },
        }
      },
    },

    /**
     * lib 内相对路径禁止跨 lib 逃逸（`import` 与 re-export 两类依赖边）。
     *
     * 判据：文件名落在 `<cwd>/libs/<name>/` 下时，`./` / `../` 开头的 import / export source
     * 解析出的绝对路径必须仍在该 lib 根内；`libs/` 之外（apps/**）不适用（create 直接返回空监听）。
     *
     * 为什么需要：分层门禁的 `no-restricted-imports` 只认识 `@walnut-server/*` 别名，
     * `import '../../system/src/system.module'` 与 `export * from '../../identity/src/index'`
     * 都能绕过整张方向表而不报错。
     *
     * ESLint 10 已移除 `context.getFilename()`，这里用 `context.filename`（相对 `context.cwd`
     * 解析，CLI 传绝对路径时 resolve 是恒等变换）。
     */
    'no-cross-lib-relative-import': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow relative imports / re-exports that escape the current internal lib (libs/<name>)',
        },
        schema: [],
        messages: {
          crossLib: '相对路径已逃出当前 lib：{{source}} 解析到 {{target}}。跨 lib 依赖请用 @walnut-server/* 别名，让分层门禁可见。',
        },
      },

      create(context) {
        const libRoot = resolveLibRoot(context.cwd, context.filename)
        if (libRoot === null)
          return {}

        const fileDir = dirname(resolve(context.cwd, toPosixPath(context.filename)))

        /** source 是相对路径且解析后逃出 lib 根时返回该边（否则 null） */
        function findEscapedSource(node: SourceLike): { source: string, target: string } | null {
          const source = node.source?.value
          if (typeof source !== 'string')
            return null
          if (!source.startsWith('./') && !source.startsWith('../'))
            return null

          const target = toPosixPath(resolve(fileDir, source))
          if (target === libRoot || target.startsWith(`${libRoot}/`))
            return null

          return { source, target: `./${relative(context.cwd, target).replace(/\\/g, '/')}` }
        }

        /** ImportDeclaration / ExportNamedDeclaration / ExportAllDeclaration 共用（无 source 的 export 跳过） */
        function checkSource(node: SourceLike): void {
          const escaped = findEscapedSource(node)
          if (escaped === null)
            return

          context.report({
            // ESTree 的节点类型没有本规则需要的 TS-ESLint 扩展，且这里只是把真实节点交给报告器定位
            node: node as never,
            messageId: 'crossLib',
            data: escaped,
          })
        }

        return {
          ImportDeclaration: checkSource,
          ExportNamedDeclaration: checkSource,
          ExportAllDeclaration: checkSource,
        }
      },
    },
  },
}

export default plugin
