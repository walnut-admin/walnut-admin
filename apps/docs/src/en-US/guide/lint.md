# 项目规范

> 本页是**多仓合并与工具链收拢之前**的旧文档，保留作对照。文中 `config/*` 下的路径、husky、
> stylelint、prettier、cz-customizable 都已不在本仓：现行的 lint 预设与门禁口径见
> [ESLint 配置](/content/monorepo/eslint.md)，git 钩子由 lefthook 托管（见
> [ADR 0018](/content/adr/0018-git-hooks-lefthook.md)）。

## 介绍

::: tip 使用 lint 的好处

具备基本工程素养的同学都会注重编码规范，而代码风格检查（Code Linting，简称 Lint）是保障代码规范一致性的重要手段。

遵循相应的代码规范有以下好处

- 较少 bug 错误率
- 高效的开发效率
- 更高的可读性

:::

项目内集成了以下几种代码校验方式

1. [eslint] 用于校验代码质量与规则（格式不在它职责内，见下方 Prettier 一节）
2. [commitlint] 用于校验 git 提交信息规范
3. ~~[stylelint] 用于校验 css/less 规范~~（已移除）
4. ~~[prettier] 代码格式化~~（已移除，格式化由 oxfmt 承担）

::: warning
lint 不是必须的，但是很有必要，一个项目做大了以后或者参与人员过多后，就会出现各种风格迥异的代码，对后续的维护造成了一定的麻烦
:::

:::info
[eslint] 负责规则检查，格式化由 **oxfmt** 承担：ESLint 的三个预设都设 `stylistic: false`，再以 `eslint-config-prettier` 兜底，格式化规则不再由 ESLint 提供。
:::

## ESLint

### 配置项

项目的 eslint 配置已抽成共享包 [tooling/eslint-config](https://github.com/walnut-admin/walnut-admin/tree/main/tooling/eslint-config)，各包的 `eslint.config.ts` 从它 extends（flat config）。可以根据团队自行修改代码规范。

### vscode 配合

推荐安装 vscode 的 eslint 插件，因为在`.vscode/settings.json`中默认配置了自定义好的 eslint 相关配置文件。开发体验会更加舒适。

### 相关插件

项目是 vue 项目，所以添加了[eslint-plugin-vue]。

因为因为项目使用了 ts，所以添加了两个插件[@typescript-eslint/eslint-plugin](https://www.npmjs.com/package/@typescript-eslint/eslint-plugin)和[@typescript-eslint/parser](https://github.com/typescript-eslint/typescript-eslint/tree/main/packages/parser)。

### 手动校验

执行`pnpm lint`（或 `pnpm --filter @walnut/admin lint`），然后查看控制台即可。

### 规则

如果有想要禁用的规则，只需要在 rules 下添加一条对应的规则名，然后值设置为 0 或 1 即可。

:::tip

- "off" 或 0 - 禁用规则
- "warn" 或 1 - 只是个警告，不会阻塞进程
- "error" 或 2 - 错误，会阻塞进程

:::

- 示例：

```jsonc
{
  // 禁用不能使用any
  "@typescript-eslint/no-explicit-any": 0,
  // 禁用不能有未使用的变量
  "@typescript-eslint/no-unused-vars": 0
}
```

项目配置了多条规则，都是和 ts 相关的。具体查看共享预设[tooling/eslint-config](https://github.com/walnut-admin/walnut-admin/tree/main/tooling/eslint-config)。

:::tip

- 所有的 eslint 规则请查看[rules](https://eslint.org/docs/rules/)。
- 所有的 eslint-vue 规则请查看[rules-vue](https://eslint.vuejs.org/rules/)。
- 所有的 eslint-ts 规则请查看[rules-ts](https://typescript-eslint.io/rules/)。

:::

### 如何关闭

:::warning
强烈不推荐关闭 eslint 的校验
:::

在根 `package.json` 的 [`lint-staged`](https://github.com/walnut-admin/walnut-admin/blob/main/package.json) 块里删掉 eslint 那条即可。

## CommitLint

在一个团队中，每个人的 git 的 commit 信息都不一样，五花八门，没有一个机制很难保证规范化，如何才能规范化呢？可能你想到的是 git 的 hook 机制，去写 shell 脚本去实现。这当然可以，其实 JavaScript 有一个很好的工具可以实现这个模板，它就是 commitlint（用于校验 git 提交信息规范）。

### 配置项

项目的 commitlint 配置收口在 [tooling/commitlint-config](https://github.com/walnut-admin/walnut-admin/tree/main/tooling/commitlint-config)（共享预设），根 `commitlint.config.ts` 只负责 extends 它。

### 提交信息规范

- 参考[angular](https://github.com/conventional-changelog/conventional-changelog/tree/master/packages/conventional-changelog-angular)的主流规范

  - `feat` 新功能
  - `fix` 修复 bug
  - `docs` 文档变更
  - `style` 样式变更
  - `refactor` 既不是修复 bug，也不是新功能，字面可以理解为重构
  - `perf` 性能优化
  - `chore` 依赖更新/脚手架配置修改等
  - `revert` 撤销修改
  - `test` 测试
  - `ci` CI/CD
  - `build` 构建相关

### 示例

```bash
git commit -m 'feat(home): add home page'
```

### 规则

项目配置了一些 commitlint 的规则，具体查看[tooling/commitlint-config/index.ts](https://github.com/walnut-admin/walnut-admin/blob/main/tooling/commitlint-config/index.ts)。

:::tip
所有的 commitlint 规则请查看[rules](https://commitlint.js.org/#/reference-rules)。
:::

### 如何关闭

在根 `lefthook.yml` 的 `commit-msg` job 中注释掉下面一行即可

```bash
# pnpm exec commitlint --edit {1}
```

### 自定义 commit 格式

commit 的 type / scope 选项收口在 [tooling/commitlint-config/index.ts](https://github.com/walnut-admin/walnut-admin/blob/main/tooling/commitlint-config/index.ts) 的 `type-enum` 与 `scope-enum`。

- 旧配置示例（cz-customizable，已移除）

```jsonc
{
  // 提交字数不超过100
  "subjectLimit": 100,

  // 提交的scope，即指`feat(button)`这样信息的括号中的内容，下面四个是项目默认提供的scope
  "scopes": [
    { "name": "dependencies" },
    { "name": "config" },
    { "name": "component" },
    { "name": "doc" }
  ]
}
```

:::warning
如果要新添加或删除 commit 的 header 信息，只改一处即可：[tooling/commitlint-config/index.ts](https://github.com/walnut-admin/walnut-admin/blob/main/tooling/commitlint-config/index.ts) 里 rules 的 `type-enum`。cz-customizable 已随工具链收拢移除，不再需要同时维护两份配置。
:::

## StyleLint

StyleLint 曾用于校验项目内部 css 的风格，加上编辑器的自动修复，可以很好的统一项目内部 css 风格。虽然但是，项目集中使用了 UnoCSS，真正需要做样式校验的地方已经不多了。本项目现在**已不再使用 stylelint**（见下「配置项」），这一节保留作对照。

### 配置项

项目已不再使用 stylelint，原有的 `config/stylelint` 配置已随工具链收拢移除。

### vscode 配合

不再需要安装 stylelint 插件（已移除）。

### 手动校验

已移除，没有对应的校验命令。

### 规则

原有的 stylelint 规则文件已随工具链收拢移除。

:::tip
所有的 stylelint 规则请查看[rules](https://stylelint.io/user-guide/rules/list)。
:::

### 如何关闭

stylelint 已移除，无需关闭。

## Prettier

### 配置项

项目不使用 Prettier：格式化由 **oxfmt** 统一承担，配置在根 `.oxfmtrc.json`（`printWidth: 100`，单引号、无分号、尾逗号 `all`）；ESLint 已 `stylistic: false` 只做规则检查，详见[ESLint 配置](/content/monorepo/eslint.md)。

### vscode 配合

不再需要安装 prettier 插件（格式化由 `oxfmt` 命令承担）。

### 手动校验

执行`pnpm walnut format:check`（只检查）或 `pnpm walnut format:fix`（写回文件），然后查看控制台即可。

### 规则

没有独立的 prettier 规则文件：格式选项在根 `.oxfmtrc.json`。

:::tip
所有的 prettier 规则请查看[rules](https://prettier.io/docs/en/options.html)。
:::

### 如何关闭

Prettier 已移除（格式化由 oxfmt 承担），无需关闭。

## Git Hook

git hook 一般结合各种 lint，在 git 提交代码的时候进行代码风格校验，如果校验没通过，则不会进行提交。需要开发者自行修改后再次进行提交。

### lefthook

有一个问题就是校验会校验全部代码，但是我们只想校验我们自己提交的代码，这个时候就需要一个钩子管理器。

最有效的解决方案就是将 Lint 校验放到本地，常见做法是使用 lefthook（或 pre-commit）在本地提交之前先做一次 Lint 校验。

项目自 2026-09-23 起改由 lefthook 托管钩子（替代 husky / simple-git-hooks），钩子内容的唯一真源是根 `lefthook.yml`，理由见 [ADR 0018](/content/adr/0018-git-hooks-lefthook.md)。钩子有没有真的装上，用 `pnpm walnut hooks:check` 机械核对。

### 如何关闭

```bash
# 从根 lefthook.yml 中删掉对应 job，或在本地卸载钩子
pnpm exec lefthook uninstall
```

### 如何跳过检查

```bash
# 加上 --no-verify即可跳过git hook校验（--no-verify 简写为 -n）
git commit -m "xxx" --no-verify
```

### lint-staged

项目的 lint-staged 配置位于根 `package.json` 的 `lint-staged` 块

```json
{
  "lint-staged": {
    "*.{ts,vue,js}": [
      "oxfmt --write",
      "oxlint --fix",
      "eslint --fix --concurrency=4"
    ]
  }
}
```

<!-- link -->

[eslint]: https://eslint.org/
[commitlint]: https://commitlint.js.org/
[stylelint]: https://stylelint.io/
[prettier]: https://prettier.io/
[husky]: https://typicode.github.io/husky/#/
[lint-staged]: https://github.com/okonet/lint-staged
[cz-customizable]: https://github.com/leoforfree/cz-customizable
[eslint-plugin-vue]: https://eslint.vuejs.org/
