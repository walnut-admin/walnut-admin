# Zod vs class-validator — Evaluation

> 评估日期：2026-07-29
> 状态：**暂不迁移**，待触发条件满足后重新评估（见 [ADR-0016](../adr/0016-validation-strategy.md)）

---

## 对比

| 维度 | Zod | class-validator（当前） |
|------|-----|------------------------|
| 类型推断 | ✅ `z.infer<typeof schema>` 自动推导 | ❌ 需手动写 interface |
| 前端可用 | ✅ 零依赖，轻量 | ❌ 依赖 `reflect-metadata` + decorators |
| NestJS 集成 | 需自定义 Pipe | ✅ `ValidationPipe` 原生支持 |
| Swagger 文档 | 需额外配置 | ✅ 装饰器内联 Swagger |
| 前端表单验证 | ✅ VeeValidate + Zod 原生集成 | ❌ 需单独写验证规则 |
| 当前代码库 | 0 使用 | ~100+ DTO 类，6 个子系统，30+ 装饰器文件 |
| 学习成本 | 中（团队需学习 Zod DSL） | 低（团队已熟悉） |
| 运行时性能 | 中等 | 中等 |

## 不迁移的原因

1. **装饰器体系已成熟**：`WalnutAdminDecoratorField*` 将 validation + transformation + Swagger docs 统一到一个装饰器中，实现了类似 Zod "单一声明"的体验
2. **迁移成本太高**：涉及 16 个 guard、中件间/interceptor 层、`libs/decorators/` 6 个子系统、~100+ DTO 类
3. **前端表单验证复用不是当前痛点**：要发挥 Zod 的前后端复用优势，需要前端接入 VeeValidate + Zod，目前没有这个需求
4. **避免双范式并存**：逐步迁移意味着长期维护 class-validator 和 Zod 两套体系

## 触发条件（何时重新评估）

| 触发条件 | 说明 |
|---------|------|
| 前端接入 VeeValidate + Zod | DRY 验证变为可实现 |
| 新建 NestJS 绿场模块 | 可在新模块试点 Zod，无需迁移旧代码 |
| `class-validator` 停止维护或不兼容 NestJS 新版本 | 强制迁移 |
| 3+ 个前端应用共享同一后端 | 共享 schema 的 ROI 提高 |

## 参考

- [ADR-0016: Validation Strategy](../adr/0016-validation-strategy.md)
- [docs/reference/07-fullstack-architecture.md](../reference/07-fullstack-architecture.md) — 业界推荐
- [Zod 官方文档](https://zod.dev/)
- [NestJS Zod Pipe 社区实现](https://github.com/risen228/nestjs-zod)
