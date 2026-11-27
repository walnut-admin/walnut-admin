/**
 * 多选界面的**唯一副作用层**：`@clack/prompts` 只在这里出现。
 *
 * ## 为什么惰性 import
 *
 * `--list` / `--json` / `--help` 与「带 id 直接执行」都不该为一个用不上的界面库付解析成本，
 * 也不该让那些路径的模块图多出一条第三方边。所以 `@clack/prompts` 只在**本函数被调用时**才
 * `await import(...)`：`run/select.ts` 与 `main.ts` 可以静态 import 本模块，界面库不会跟着加载。
 *
 * ## 为什么不用库自带的 `cancel()`
 *
 * 它只负责往 stdout 打一行红字（1.9.0 实测：函数体只有一次 `write`，**不**退出进程 —— 决定
 * 退出的是官方示例里紧跟其后的 `process.exit(0)`）。本入口的结语与退出码统一由 `runCli` 给
 * （「已取消，什么都没跑」是正常叙述、退出码 0），所以这里只留 `isCancel()` 判定取消，
 * 把结局交回调用方（`select.ts` 的 `ChooseOutcome`，打印与退出码归 `main.ts`）。
 *
 * ## 界面形态
 *
 * `groupMultiselect` 就是「上下键移动、空格勾选、回车确认」；分组顺序就是传入对象的键顺序
 * （`select.ts` 已按表排好）。分组标题**不参与勾选**：空格只勾一条命令。
 */

import type { CommandGroupOptions } from './select.ts'

/**
 * 起多选界面，返回勾中的命令 id（先后无所谓，排序是调用方的事）；`null` = 用户取消。
 *
 * 只负责「问」，不负责「跑」与「怎么说」：空选返回空数组，取消返回 null，其余原样交回。
 */
export async function pickCommandIds(
  groups: readonly CommandGroupOptions[],
): Promise<readonly string[] | null> {
  const { groupMultiselect, isCancel } = await import('@clack/prompts')

  const options: Record<string, { value: string; label: string }[]> = {}
  for (const group of groups)
    options[group.group] = group.options.map((option) => ({
      value: option.value,
      label: option.label,
    }))

  const picked = await groupMultiselect({
    message: '选要跑的命令（空格勾选，回车执行）',
    options,
    // 空选不是错（「什么都没跑」由 main.ts 说）：required 的默认值是 true，会让回车变成校验失败
    required: false,
    // 空格只勾一条命令：在分组标题上误按一次就把整组全选上再回车（门禁组是整张表里最长的一组），代价太大
    selectableGroups: false,
  })

  if (isCancel(picked)) return null
  return picked
}
