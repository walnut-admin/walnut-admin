---
name: 代码检查
description: 运行 TypeScript 类型检查和 ESLint，报告结果。适用场景：验证代码是否通过类型检查和 lint 规则。
when_to_use: 检查代码、验证类型、运行 lint、检查一下、lint 一下、类型检查
---

# 代码检查

## 核心约束

- 必须从 monorepo 根目录运行命令
- 必须同时运行类型检查和 lint，二者缺一不可
- 报告时只列错误，不输出无意义的完整日志

## 执行步骤

1. 运行类型检查：

```bash
pnpm types:check
```

仅检查 server 包时：

```bash
pnpm --filter @walnut/server types:check
```

2. 运行 ESLint 自动修复：

```bash
pnpm lint:fix
```

3. 报告结果：
   - 全部通过：简短说明"类型检查和 lint 通过"
   - 有错误：按文件分组列出错误，标注行号
   - 禁止在无错误时输出完整命令日志
