/**
 * 「会读生成物」的可执行名字 —— 这条门禁的**唯一真源**。
 *
 * `check-pre-hooks.ts` 只读这份数据、不再自带名单：新增一个消费者（例如将来某个只跑
 * `tsrs` / `tsc` 的检查器）**只改这里**，门禁逻辑一行不动。名单过期是长期噪音源，
 * 所以每条都带 `why`（为什么它算消费者）与 `exemptSubcommands`（哪些子命令例外）——
 * 理由写在数据里，而不是散落在门禁代码的注释里。
 *
 * 判定口径：脚本首词（剥掉 `cross-env` / `KEY=value` 之后）命中某个 `bin`，就算消费者。
 * 只对「包内有 `build/generate/`」的包生效 —— 没有生成物的包完全不管。
 */
export interface PreHookConsumer {
  /** 脚本首词（剥掉 cross-env / KEY=value 之后比对） */
  bin: string
  /** 这些子命令伺服的是已构建产物，不要求 pre 钩子（如 `vite preview`） */
  exemptSubcommands?: readonly string[]
  /** 凭什么它算消费者 —— 写给人看，也写在数据里而不是注释里 */
  why: string
}

export const PRE_HOOK_CONSUMERS: readonly PreHookConsumer[] = [
  {
    bin: 'vite',
    exemptSubcommands: ['preview'],
    why: 'vite 的检查器（vite-plugin-checker）可能在插件把 dts 写盘之前就建好 TS program（2026-09-24 Build admin 事故）',
  },
  {
    bin: 'vue-tsc',
    why: 'vue-tsc 是最早读生成物的那个：types:check 前必须已经生成组件声明与 schema',
  },
]
