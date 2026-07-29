# 架构待办事项

> 基于 ADR 实现差距 + 行业调研对比，梳理架构层面剩余工作。按优先级 P0-P3 排列。

---

## P0 — 阻塞项（必须尽快解决）

| # | 事项 | 来源 | 工作量 | 说明 |
|---|------|------|--------|------|
| 1 | **CI/CD 流水线** | ADR 0009 | 中 | 当前无 CI workflow。需新增 `.github/workflows/ci.yml`，串联 lint → typecheck → test → build，加入 affected-only 过滤 |
| 2 | **共享包测试** | ADR 0009 / 0015 | 中 | `@walnut/utils`（queue、regex、crypto）、`@walnut/contract`（快照测试）至今零测试。是 CI 流水线的前置条件 |
| 3 | **前端构建修复** | ADR README 遗留 | 小 | `apps/admin` build 被 env 校验插件阻塞（已有问题，非本次重构引入） |

---

## P1 — 高收益（有明确的效率/质量提升）

| # | 事项 | 来源 | 工作量 | 说明 |
|---|------|------|--------|------|
| 4 | **Turbo Remote Cache** | 行业调研 | 小 | `npx turbo login` + `npx turbo link` 即可接入 Vercel Remote Cache（免费）。CI 构建从分钟级变秒级 |
| 5 | **部署流水线** | ADR 0008 | 大 | `deploy.yml` 从手动 SCP 改为 `pnpm deploy --filter`，加路径过滤，加前端部署 job |
| 6 | **commitlint** | 行业调研 | 小 | enforce conventional commit 格式。Changesets + git-cliff 依赖 commit message 规范 |
| 7 | **Changeset Bot** | 行业调研 | 小 | GitHub App，PR 中自动提醒缺少 changeset。一次安装，零维护 |

---

## P2 — 锦上添花（改善体验）

| # | 事项 | 来源 | 工作量 | 说明 |
|---|------|------|--------|------|
| 8 | **Docker 多阶段构建** | 行业调研 | 中 | `apps/server/Dockerfile`，生产镜像仅含运行时依赖。当前无容器化部署 |
| 9 | **syncpack** | 行业调研 | 小 | 强制 workspace 中同类依赖版本一致（即使 catalog 也偶尔会有漏网之鱼） |
| 10 | **Codecov / 覆盖率报告** | 行业调研 | 小 | PR 上自动评论覆盖率变化。免费，依赖 P0-2 测试先落地 |
| 11 | **GitHub Environments** | 行业调研 | 中 | 多环境部署（staging / production），按环境隔离 Secrets |

---

## P3 — 远期（当前不做）

| # | 事项 | 来源 | 原因 |
|---|------|------|------|
| 12 | **Zod 替换 class-validator** | ADR 0016 | 工程量巨大（100+ DTO 类，6 个子系统）。评估已完成，暂不迁移 |
| 13 | **E2E 测试（Playwright）** | 行业调研 | 优先覆盖单元+集成测试。E2E 在测试体系稳定后再加 |
| 14 | **Vitest 共享 preset** | 行业调研 | 包数量少（4个），直接复制配置即可。packages 超过 5 个后再提取 |
| 15 | **oxlint / biome** | 行业调研 | 都不支持 Vue SFC。等支持后再加为 ESLint 的快速第一道扫描 |

---

## 执行记录

| 日期 | 完成项 |
|------|--------|
| 2026-07-29 | P0 剩余 3 项未完成 |

---

## 相关文档

- [ADR 索引](../adr/)
- [ADR 0009 - CI Quality Gates](../adr/0009-ci-quality-gates.md)
- [行业调研 - CI/CD](../industry-research/03-ci-cd-pipeline.md)
- [行业调研 - 测试](../industry-research/04-testing-strategy.md)
