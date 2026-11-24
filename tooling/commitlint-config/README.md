# `@walnut/commitlint-config` —— 共享 commitlint 规则

> 根 `commitlint.config.ts` 只做一件事：`extends: ['@walnut/commitlint-config']`。
> 真正的规则表在本包 `index.ts` —— 提交信息由 lefthook 的 `commit-msg` 钩子调
> `pnpm exec commitlint --edit {1}` 校验（根 `lefthook.yml`）。

## 它管什么

| 规则 | 判据 | 为什么值得集中 |
|------|------|----------------|
| `type-enum` | type 只能取白名单里的值（`feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `chore` / `ci` / `build` / `revert`） | changelog 按 type 分组，自造的 type 会静默落进「其它」 |
| `scope-empty` | scope **必填** | 没有 scope 的提交无法按包归因，发版的「路径优先、scope 兜底」就少一档 |
| `scope-enum` | scope 必须在白名单里 | 写错一个包名不会报错，只会让这条提交在发版归属里查无此人 |
| `subject-case` | **刻意关掉** | 默认值会拒绝任何以大写拉丁字母开头的 subject，误伤 `F9 裁决` / `NODE_ENV` 这类正常写法；type / scope 的大小写与白名单另有四条规则把守（取舍见 `index.ts` 的长注释） |

## scope 白名单的口径

真源是 `index.ts` 的 `SCOPES` 数组。判据：

- **app 与业务 / 共享包**用包名（`admin` / `server` / `docs` / `contract` / `client` / `http` …）；
- **工具链包**里只有 `eslint-config` / `commitlint-config` 单列了 scope，其余（`tsconfig` /
  `vitest-config` / `scripts` / 发版编排本身）统一走 **`tooling`** —— 与根 `AGENTS.md` 关键纪律 2
  的「工具链包的改动走 `tooling`」是同一条口径；
- **基础设施 scope**：`docker` / `deploy` / `pnpm`；
- **`release`**：只给发版记账提交 `chore(release): vX.Y.Z` 用，不是包 scope（发版编排的改动走
  `tooling`）。

白名单**不会**从 workspace 包清单自动推导：新增一个需要被单独归因的包时，要手工往 `SCOPES` 里加
一行；不加也能提交，只是用 `tooling` 兜底。

## 怎么消费与扩展

```ts
// 根 commitlint.config.ts
export default {
  extends: ['@walnut/commitlint-config'],
}
```

消费方在 `extends` 之后再写 `rules` 即可覆盖（commitlint 的配置合并语义：后写的规则赢）。
新增一个常规 type 或基础设施 scope 要同时想清楚三处：本包的 `type-enum` / `SCOPES`、
`@walnut/release` 的归属表（`attribution.ts` 的 `INFRA_SCOPES` / `NON_PACKAGE_SCOPES` 与这里保持同口径），
以及根 `AGENTS.md` 关键纪律 2 的写法。

## 已知限制

- **`git revert` 自动生成的信息不满足格式**（`Revert "…"` 没有 `type(scope):`）。按 `index.ts` 的
  注释处理：用 `--no-verify` 放行，或把它改写成 `revert(<scope>): …` 再提交。
- 本包由 **commitlint 自己的 TS loader 加载**（不是 Node 原生类型剥离），所以 tsconfig 用
  `base.json` 预设，`types:check` 是真正的 `tsc --noEmit`。
- 本包没有测试：规则是声明式的，唯一的行为判据就是 `pnpm exec commitlint --edit <文件>`
  （lefthook 的 `commit-msg` 与每次真实提交都在跑它）。
