import type { ValueOf } from 'easy-fns-ts'

// 只保留真正被 `Symbol(AppConstSymbolKey.<KEY>)` 消费的三个注入键（2026-11-28 删除
// `AUTH_KEY` / `LAYOUT_KEY`：全仓 grep 零消费，属死枚举 —— 留着会让人以为存在对应的注入协议）。
export const AppConstSymbolKey = {
  FORM_KEY: 'w-form',
  TABLE_KEY: 'w-table',
  TABS_KEY: 'w-tabs',
}

export type ValueOfAppConstSymbolKey = ValueOf<typeof AppConstSymbolKey>
