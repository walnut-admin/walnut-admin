import type { Rule } from 'eslint'

/**
 * 本地 ESLint 规则：**脚本入口的两条形态约定**（待办 P1-19，来自交叉对比的 C5）。
 *
 * 为什么是本地规则而不是再写一个 bin：本仓已有成文约定却零判据的两条，都长在**每个文件内部**
 * —— 那是 ESLint 的天然作用域，写成门禁脚本反而要自己解析 AST 与文件发现。
 * 参考仓有 13 条本地规则 + 每条配 RuleTester 正反语料；本仓**只搬这两条**，
 * 因为它们在本仓是「真约定、零判据」，而不是「参考仓有所以我们也要有」。
 *
 * ## `script-header`：文件头要有注释
 *
 * ⚠️ **它只保证「有一段文件头」，不保证它写得好** —— 本仓 bin 里那段（「由 Node 原生执行 `.ts`…」）
 * 是逐字相同的模板，它**能过**这条规则。别把它读成文档质量门禁；它挡的是「新加一个 bin，
 * 一句注释都没有」（2026-09-23 实测：13 个 bin 里有 2 个连模板都没有）。
 *
 * ## `script-exit-code`：退出码只能 0 / 1 / 2
 *
 * 本仓的三态退出码（0 通过 / 1 查出违规 / 2 前置条件未满足）写在多份文档里，
 * 此前**没有任何东西在查**。判据落在两个**真正的退出口**上：
 *   · `process.exit(<数字字面量>)`
 *   · **名为 `main` 的函数**里的 `return <数字字面量>`（本仓的惯例是 bin 里 `process.exit(main())`）
 *
 * 刻意**不查**的两处（宁可漏报不可误报）：
 *   · `process.exit(变量)` —— 判不出取值；全仓的 bin 都是 `process.exit(main())` 这一形态。
 *   · `process.exitCode = N` —— 那是个合法的「信号码」出口（SIGINT 之类会写 130），
 *     按 0/1/2 去卡它会误报。
 * 近邻函数判定用的是**最近的一层函数**：`main()` 里嵌套的箭头函数返回 `-1` 不算违规
 * （那不是退出码）。
 */

/** 本仓的三态退出码。写在规则里而不是散在调用方 —— 它是「退出码」这件事的全部语义。 */
const DEFAULT_ALLOWED = [0, 1, 2]

interface ExitCodeOptions {
  allowed?: number[]
}

/**
 * 取数字字面量的值。
 *
 * ⚠️ **必须同时处理一元负号**：`process.exit(-1)` 在 AST 里是 `UnaryExpression(-, Literal(1))`，
 * 不是 `Literal(-1)` —— 只认 `Literal` 会让 `-1` 这种最典型的坏退出码**静默漏过**
 * （本规则的用例里就有这一条，第一版正是这么挂的）。
 */
function numericLiteral(node: unknown): number | null {
  const n = node as { type?: string, value?: unknown, operator?: string, argument?: unknown } | undefined
  if (n?.type === 'Literal' && typeof n.value === 'number')
    return n.value
  if (n?.type === 'UnaryExpression' && n.operator === '-' && typeof n.argument === 'object' && n.argument !== null) {
    const inner = numericLiteral(n.argument)
    return inner === null ? null : -inner
  }
  return null
}

const scriptHeader: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require a leading comment block in script entry files',
    },
    schema: [],
    messages: {
      missing: '脚本入口必须有文件头注释（说明这个脚本做什么）—— 本仓 bin 的惯例是开头一段 `//` 或 `/** */`。',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode
    return {
      Program(node) {
        const first = node.body[0]
        if (first === undefined)
          return
        // `range[1] <= first.range[0]` = 只认**第一个语句之前**的注释。
        // （ESLint 的类型把 `range` 标成可选，但解析器一定会给 —— 拿不到就当没有，
        //   宁可漏报也不误报。）
        const head = first.range?.[0] ?? -1
        const header = sourceCode.getAllComments().some((comment) => {
          // shebang（`#!/usr/bin/env node`）**不算文件头** —— 它每份都一样，说明不了任何事。
          // ⚠️ 必须按运行期的 `type === 'Shebang'` 判：ESLint 的**类型定义里没有这一支**
          // （`Comment` 只声明 `Line | Block`），所以这里要显式放宽成 string 再比 ——
          // 直接写 `!== 'Shebang'` 会被 TS 判成「两个类型没有交集」的恒真比较。
          if ((comment.type as string) === 'Shebang')
            return false
          return (comment.range?.[1] ?? Number.POSITIVE_INFINITY) <= head
        })
        if (!header)
          context.report({ node: first, messageId: 'missing' })
      },
    }
  },
}

const scriptExitCode: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Restrict script exit codes to the repo three-state convention (0/1/2)',
    },
    schema: [{
      type: 'object',
      properties: { allowed: { type: 'array', items: { type: 'number' } } },
      additionalProperties: false,
    }],
    messages: {
      exit: '退出码只能是 0（通过）/ 1（查出违规）/ 2（前置条件未满足），这里写的是 {{value}}。',
      mainReturn: '`main()` 的返回值就是退出码，只能是 0 / 1 / 2，这里返回的是 {{value}}。',
    },
  },

  create(context) {
    const options = (context.options[0] ?? {}) as ExitCodeOptions
    const allowed = new Set(options.allowed ?? DEFAULT_ALLOWED)

    /** 最近的一层函数是不是名为 `main` 的函数声明 */
    function insideMain(node: unknown): boolean {
      const ancestors = context.sourceCode.getAncestors(node as never)
      for (let i = ancestors.length - 1; i >= 0; i--) {
        const a = ancestors[i] as { type?: string, id?: { name?: string } | null }
        const isFunction = a.type === 'FunctionDeclaration' || a.type === 'FunctionExpression'
          || a.type === 'ArrowFunctionExpression'
        if (!isFunction)
          continue
        return a.type === 'FunctionDeclaration' && a.id?.name === 'main'
      }
      return false
    }

    return {
      CallExpression(node) {
        const callee = node.callee as { type?: string, object?: { name?: string }, property?: { name?: string } }
        const isProcessExit = callee.type === 'MemberExpression'
          && callee.object?.name === 'process'
          && callee.property?.name === 'exit'
        if (!isProcessExit || node.arguments.length !== 1)
          return
        const value = numericLiteral(node.arguments[0])
        if (value === null || allowed.has(value))
          return
        context.report({ node, messageId: 'exit', data: { value: String(value) } })
      },

      ReturnStatement(node) {
        const value = numericLiteral(node.argument)
        if (value === null || allowed.has(value))
          return
        if (!insideMain(node))
          return
        context.report({ node: node.argument as never, messageId: 'mainReturn', data: { value: String(value) } })
      },
    }
  },
}

const plugin: { rules: Record<string, Rule.RuleModule> } = {
  rules: {
    'script-header': scriptHeader,
    'script-exit-code': scriptExitCode,
  },
}

export default plugin
export { DEFAULT_ALLOWED, scriptExitCode, scriptHeader }
