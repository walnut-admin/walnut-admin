// eslint-local-rules.mjs
export default {
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
        // 方法装饰器顺序
        const defaultMethodOrder = [
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
          'WalnutDBTransaction',
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

        // 参数装饰器顺序（用于参数排序）
        const defaultParamOrder = [
          'WalnutAdminDecoratorJti',
          'WalnutAdminDecoratorUser',
          'WalnutAdminDecoratorDeviceId',
          'WalnutDBSession',
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

        // 类装饰器顺序
        const defaultClassOrder = [
          'Controller',
          'ApiTags',
          'UseGuards',
        ]

        const options = context.options[0] || {}
        const methodOrder = options.methodOrder || defaultMethodOrder
        const paramOrder = options.paramOrder || defaultParamOrder
        const classOrder = options.classOrder || defaultClassOrder

        function getPriority(name, orderArray) {
          const idx = orderArray.findIndex(o => name.startsWith(o))
          return idx === -1 ? orderArray.length : idx
        }

        function extractName(decorator) {
          if (decorator.expression.type === 'CallExpression') {
            return decorator.expression.callee.name || ''
          }
          if (decorator.expression.type === 'Identifier') {
            return decorator.expression.name
          }
          return ''
        }

        function getIndent(src, node) {
          const startLine = node.loc.start.line
          if (startLine === 1)
            return ''

          const lineStart = src.getIndexFromLoc({ line: startLine, column: 0 })
          const nodeStart = node.range[0]
          const line = src.getText().substring(lineStart, nodeStart)
          return line.match(/^\s*/)[0]
        }

        function sortMethodDecorators(decorators, orderArray) {
          return [...decorators].sort((a, b) => {
            const ap = getPriority(a.name, orderArray)
            const bp = getPriority(b.name, orderArray)
            return ap !== bp ? ap - bp : a.idx - b.idx
          })
        }

        function handleClassOrMethodDecorators(node, orderArray, nodeType) {
          if (!node.decorators || node.decorators.length <= 1)
            return

          const decorators = node.decorators.map((dec, idx) => ({
            node: dec,
            name: extractName(dec),
            idx,
          }))

          const sorted = sortMethodDecorators(decorators, orderArray)
          const needsFix = decorators.some((d, i) => d.name !== sorted[i].name)

          if (!needsFix)
            return

          context.report({
            node,
            message: `${nodeType} decorators should be ordered according to the style guide`,
            fix(fixer) {
              const src = context.sourceCode
              const first = node.decorators[0]
              const last = node.decorators[node.decorators.length - 1]
              const indent = getIndent(src, first)

              const texts = sorted.map(d => src.getText(d.node))
              const newText = texts.join(`\n${indent}`)

              return fixer.replaceTextRange([first.range[0], last.range[1]], newText)
            },
          })
        }

        return {
          ClassDeclaration(node) {
            handleClassOrMethodDecorators(node, classOrder, 'Class')
          },

          MethodDefinition(node) {
            // 1. 处理方法装饰器
            handleClassOrMethodDecorators(node, methodOrder, 'Method')

            // 2. 处理参数排序
            if (!node.value || !node.value.params || node.value.params.length <= 1)
              return

            const params = node.value.params.map((param, idx) => {
              // 处理解构参数
              const actualParam = param.type === 'AssignmentPattern' ? param.left : param
              const decorators = actualParam.decorators || []

              // 获取参数的主要装饰器名称（第一个装饰器）
              const mainDecoratorName = decorators.length > 0
                ? extractName(decorators[0])
                : ''

              // 计算完整范围（包括装饰器）
              const startPos = decorators.length > 0
                ? decorators[0].range[0]
                : param.range[0]
              const endPos = param.range[1]

              return {
                node: param,
                actualParam,
                decorators,
                mainDecoratorName,
                priority: getPriority(mainDecoratorName, paramOrder),
                fullRange: [startPos, endPos],
                idx,
              }
            })

            // 按装饰器优先级排序
            const sorted = [...params].sort((a, b) => {
              if (a.priority !== b.priority)
                return a.priority - b.priority
              return a.idx - b.idx
            })

            // 检查是否需要重排
            const needsFix = params.some((p, i) => {
              return p.mainDecoratorName !== sorted[i].mainDecoratorName
            })

            if (!needsFix)
              return

            context.report({
              node: node.value,
              message: 'Parameters should be ordered by their decorator types',
              fix(fixer) {
                const src = context.sourceCode
                const firstParam = params[0]
                const lastParam = params[params.length - 1]

                // 获取第一个参数的缩进
                const paramIndent = getIndent(src, firstParam.node)

                // 获取每个参数的完整文本（包括装饰器）
                const paramTexts = sorted.map(p =>
                  src.text.substring(p.fullRange[0], p.fullRange[1]).trim(),
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
  },
}
