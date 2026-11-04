/**
 * `walnut-scaffold-lib` 的主体：解析参数 → 算待写清单 → 落盘（幂等）。
 *
 * 真正的注册面逻辑全在 `lib-registration.ts`（纯文本变换 + 单测覆盖）；本文件只做三件事：
 * 参数校验、打印每一处改动、把失败**抛**给 `runCli` 定退出码（2 = 前置条件没满足）。
 */

import process from 'node:process'
import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { line, out } from '../lib/log.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'
import {
  applyScaffold,
  assertLibName,
  LAYER_CHOICES,
  planScaffold,
  REFUSED_LAYERS,
  SCAFFOLD_LAYERS,
} from './lib-registration.ts'

const USAGE = [
  '用法：pnpm scaffold:lib <name> --layer=<层> [--dry-run]',
  '',
  '  <name>   小写 kebab-case（例：scope-resolver）',
  `  --layer  必填。可自动登记：${LAYER_CHOICES}`,
  `           拒绝自动登记：${REFUSED_LAYERS.join(' | ')}（单成员层的接线要手工改，见模块头注释）`,
  '  --dry-run 只打印将要写什么，不落盘',
].join('\n')

interface Parsed {
  name: string
  layer: keyof typeof SCAFFOLD_LAYERS
  dryRun: boolean
}

function parseArgs(argv: readonly string[]): Parsed {
  const name = argv.find(arg => !arg.startsWith('-'))
  const layerArg = argv.find(arg => arg.startsWith('--layer='))
  const dryRun = argv.includes('--dry-run')

  if (name === undefined)
    throw new PreconditionError(`缺 lib 名。\n${USAGE}`)
  if (layerArg === undefined)
    throw new PreconditionError(`缺 --layer。\n${USAGE}`)

  const layer = layerArg.slice('--layer='.length)
  if ((REFUSED_LAYERS as readonly string[]).includes(layer)) {
    throw new PreconditionError(
      `层 ${layer} 拒绝自动登记：它的 layer(...) 接线是「单成员层」写法（...DOMAIN_LIBS.filter(lib => lib !== x)），`
      + `塞第二个 lib 会让 rank 推导出的 banned 集合与接线对不上。\n`
      + `手工改这几处：eslint.config.ts 的 DOMAIN_LIBS + 对应 layer(...) 的字面量数组 + drift spec 的 LAYER_MATRIX。\n${
        USAGE}`,
    )
  }
  if (!(layer in SCAFFOLD_LAYERS))
    throw new PreconditionError(`未知的层 ${layer}。\n${USAGE}`)

  try {
    assertLibName(name)
  }
  catch (error) {
    throw new PreconditionError((error as Error).message)
  }

  return { name, layer: layer as keyof typeof SCAFFOLD_LAYERS, dryRun }
}

/** 打印一处改动：文件名 + 增删行数（新建文件单列） */
function describe(path: string, before: string | null, after: string): string {
  if (before === null)
    return `  + ${path}（新文件，${after.split('\n').length} 行）`
  const added = after.split('\n').length - before.split('\n').length
  return `  ~ ${path}（+${added} 行）`
}

export async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const { name, layer, dryRun } = parseArgs(argv)

  const files = planScaffold(REPO_ROOT, name, layer)
  const pending = files.filter(file => file.before !== file.after)

  out(`lib ${name}（层 ${layer}）：注册面共 ${files.length} 个文件，待改 ${pending.length} 个`)

  if (pending.length === 0) {
    line('ok', '已经是最终态（零改动）—— 幂等，未写任何文件')
    return
  }

  for (const file of pending)
    out(describe(file.path, file.before, file.after))

  if (dryRun) {
    line('ok', '--dry-run：以上是全部改动，未落盘')
    return
  }

  const changed = applyScaffold(REPO_ROOT, pending)
  if (changed.length === 0)
    throw new ViolationError('清单非空但没有任何文件被写（内部不一致）')

  out('')
  out('下一步（两条都必须绿）：')
  out('  pnpm --filter @walnut/server types:check')
  out('  cd apps/server && node_modules\\.bin\\vitest.cmd run --config ./apps/api/vitest.config.ts apps/api/src/common/monorepo/__tests__/lib-registration.drift.spec.ts')
  line('ok', `已写入 ${changed.length} 个文件`)
}
