# ADR-0007: Backend Internal Libraries Stay as NestJS CLI Monorepo

**Date:** 2026-07-28
**Status:** Accepted

## Context

`apps/server/` has its own NestJS CLI monorepo with 9 internal libraries:

```
apps/server/libs/
  als/         @walnut-server/als
  config/      @walnut-server/config
  const/       @walnut-server/const
  db/          @walnut-server/db
  decorators/  @walnut-server/decorators
  exceptions/  @walnut-server/exceptions
  pipes/       @walnut-server/pipes
  types/       @walnut-server/types
  utils/       @walnut-server/utils
```

> 2026-11-04：`context` 已并入 `als`（两套 AsyncLocalStorage 模块合一、实例不合并），树按现状重排；
> 本 ADR 的判断与下面的追记都未改。

These are resolved via tsconfig `paths`, compiled by SWC, and coupled to NestJS (decorators, dependency injection, CommonJS).

The question: should they be promoted to pnpm workspace packages like `@walnut/client` and `@walnut/contract`?

## Decision

**No.** Backend libs stay as NestJS CLI internal libraries.

**Reasons:**

1. **Module system mismatch**: Backend libs are CommonJS (`module: commonjs`, `moduleResolution: node10`). Frontend workspace packages are ESM (`moduleResolution: bundler`). Promoting them would create a second class of workspace packages that can only be consumed by the backend.

2. **NestJS coupling**: These libs use `@Injectable()`, `emitDecoratorMetadata`, and NestJS-specific patterns. They are not general-purpose.

3. **Compiler coupling**: Backend uses SWC (not tsc). Promoting to workspace packages would require SWC to resolve them as external dependencies, adding configuration complexity without benefit.

4. **The boundary is already correct**: `@walnut/contract` and `@walnut/utils` (pure, framework-agnostic) bridge the gap via pnpm workspace. The NestJS-coupled code stays where it belongs — inside the server.

## Alternatives considered

- **Promote the backend libs to pnpm workspace packages** (like `@walnut/client` and `@walnut/contract`) —— the CommonJS backend libs would form a second class of workspace packages consumable only by the backend, they are tightly coupled to NestJS (`@Injectable()`, `emitDecoratorMetadata`), and SWC would have to resolve them as external dependencies, adding configuration complexity without benefit; the boundary is already bridged by the pure, framework-agnostic `@walnut/contract` and `@walnut/utils`.

## Consequences

- `@walnut-server/*` remains a separate namespace from `@walnut/*`
- Adding a new backend lib requires updating `apps/server/tsconfig.json` paths only
- Backend-only constants live in `@walnut-server/const`; shared constants go to `@walnut/contract`
- Backend-only utilities live in `@walnut-server/utils`; shared utilities go to `@walnut/utils`

## 2026-10-31 追记

「libs 解耦批 0-10」已完成：内部 lib 从 9 个基建扩散到 **34 个**（新增 identity / system / auth /
security / app-domain 等域），`apps/api/src` 只剩组合根、wire DTO 与 controller。本 ADR 的结论
（不提升为 workspace 包）不变，并且现在由 ESLint `libs-boundary` 与三个 drift spec 机械守；
分层、组合根与端口注入反转的形态由 [ADR 0022](./0022-backend-lib-layering-and-composition-roots.md)
记录。上文「Adding a new backend lib requires updating `apps/server/tsconfig.json` paths only」
是按当时的语义写的：现在新增 lib 还要同步三份 `infra/nest/*.json` 与三份 `infra/swc/*.swcrc`，
漏项由 `lib-registration.drift.spec.ts` 拦下。

## 2026-11-03 追记：`packages/platform-node` 的搬迁被实测否决

有一轮提案主张把 `libs/` 里「业务无关的基建」（28 个库）下沉到 `packages/platform-node`，
理由是与 `platform-any` / `platform-web` 对称。**实测否决了这个做法**，结论不写进配置、只写在这里，
免得下一轮再从头试一遍：

1. **dist 布局是源文件相对 cwd 的逐字符镜像**。`@swc/cli` 的 `getDest` 决定产物路径；
   把 `filenames` 指向 `../../packages/...` 之后 **build 仍然 exit 0、`verify-build-assets` 仍然绿**，
   但产物被写到 `<root>/apps/packages/...`（逃出 `dist`），`start:prod` 直接 MODULE_NOT_FOUND。
   —— 失败**不在构建期暴露**，这是最危险的一点。
2. **唯一的开关是全局布尔**：`stripLeadingPaths: true` 能让 `dist/packages` 正确，但
   `dist/apps/api/src/main.js` 会塌成 `dist/api/src/main.js`，Dockerfile 的 CMD 与 `start:prod` 全废。
3. **`include` 加跨包路径会连累 assets 校验**：strip root 被上提到工作区根 ⇒ `verify-build-assets` 红；
   补 `rootDir` 能救绿，但那会变成第 10 个注册面，且 `types:check` 因跳出
   `apps/server/node_modules` 解析链而爆 TS2307。

**触发条件（出现再重新评估，别提前做）**：出现**第二个 Node 产品**（不是第二个进程 ——
`apps/worker` 与 `apps/api` 共用同一份 `AppModule`，不构成跨包复用），
或者决定把后端能力对外发布。那时要走的是「让这两个包自建 CJS dist」的路
（照 `@walnut/contract` 的样板），而**不是**搬源码；并且第一关必须是
「tsc 产出 dist 后装饰器元数据与 SWC 等价」的验证 —— 这批库有 25 个文件依赖 Nest 装饰器元数据，
错了的症状是静默的（接口 200 但字段消失）。
