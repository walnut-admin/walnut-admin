# 测试体系

> 大型 monorepo 的测试不只是"写单元测试"——它涉及**统一测试框架、按包类型分层策略、覆盖率收集、以及测试在 CI pipeline 中的位置**。本文档覆盖完整测试体系设计。

---

## 1. 测试框架选型：Vitest 一统天下

### 1.1 业界共识

2025-2026 年，**Vitest 已成为 TypeScript monorepo 的事实标准**。主要项目（tRPC、Nuxt、Vite 自身、Slidev）均已从 Jest 迁移到 Vitest。

| 维度 | Vitest | Jest |
|------|--------|------|
| 速度 | 快（esbuild 编译） | 慢（ts-jest / babel） |
| ESM 支持 | 原生 | 需要实验性 flag |
| 配置 | 与 Vite 共享配置 | 独立的 jest.config |
| watch mode | 极快（HMR 式） | 一般 |
| 兼容性 | 大部分 Jest API 兼容 | — |
| Vue SFC 测试 | ✅ 通过 vite 插件 | ❌ 需要额外配置 |

### 1.2 安装与基础配置

```bash
pnpm add -D vitest @vitest/coverage-v8 --filter @walnut/utils
```

```ts
// vitest.config.ts — 标准模板
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,              // 不用 import { describe, it, expect }
    environment: "node",        // 默认。浏览器环境用 "jsdom"
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.spec.ts", "src/index.ts"],
    },
  },
});
```

### 1.3 共享 Vitest Preset

大型 monorepo 通常将 Vitest 配置提取成共享 preset：

```
packages/config/vitest/
├── package.json
├── base.ts        ← 全仓库基础配置
├── vue.ts         ← Vue 组件测试（extends base，加 jsdom）
└── nest.ts        ← NestJS 测试（extends base，加 swc）
```

```ts
// packages/config/vitest/base.ts
import { defineConfig, mergeConfig } from "vitest/config";

export const baseConfig = defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
    },
  },
});

// 消费者合并
export function createConfig(overrides = {}) {
  return mergeConfig(baseConfig, overrides);
}
```

消费者的 vitest.config：
```ts
// packages/utils/vitest.config.ts
import { createConfig } from "@repo/vitest-config";

export default createConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

---

## 2. 按包类型分层测试策略

### 2.1 四层分类

```
┌──────────────────────────────────────┐
│ Layer 4: E2E (Playwright/Cypress)    │ ← apps/admin, apps/server (少)
├──────────────────────────────────────┤
│ Layer 3: Integration Tests           │ ← apps/admin (API mock), apps/server (DB)
├──────────────────────────────────────┤
│ Layer 2: Component Tests             │ ← apps/admin (Vue components)
├──────────────────────────────────────┤
│ Layer 1: Unit Tests                  │ ← 全部 packages + apps
└──────────────────────────────────────┘
```

### 2.2 纯工具包（`@walnut/utils`、`@walnut/contract`）

| 测试类型 | 占比 | 说明 |
|---------|------|------|
| Unit | 100% | 纯函数，输入 → 输出，无副作用 |

```ts
// packages/utils/src/queue/__tests__/queue.test.ts
import { describe, it, expect } from "vitest";
import { Queue } from "../queue";

describe("Queue", () => {
  it("should enqueue and dequeue in FIFO order", () => {
    const queue = new Queue<number>();
    queue.enqueue(1);
    queue.enqueue(2);
    expect(queue.dequeue()).toBe(1);
    expect(queue.dequeue()).toBe(2);
  });

  it("should throw when dequeue from empty queue", () => {
    const queue = new Queue<number>();
    expect(() => queue.dequeue()).toThrow("Queue is empty");
  });
});
```

### 2.3 前端 UI 包（`@walnut/client`）

| 测试类型 | 占比 | 说明 |
|---------|------|------|
| Unit | 70% | composables 的函数逻辑（无 Vue runtime） |
| Component | 30% | `@vue/test-utils` mount 测试 |

```ts
// packages/client/src/hooks/__tests__/useCounter.test.ts
import { describe, it, expect } from "vitest";
import { useCounter } from "../useCounter";

describe("useCounter", () => {
  it("should increment", () => {
    // 注意：composable 可以在 setup context 外直接测试
    const { count, increment } = useCounter();
    expect(count.value).toBe(0);
    increment();
    expect(count.value).toBe(1);
  });
});
```

### 2.4 Vue 应用（`apps/admin`）

| 测试类型 | 占比 | 说明 |
|---------|------|------|
| Unit | 30% | Pinia stores、API 层、工具函数 |
| Component | 50% | Vue components + user interactions |
| Integration | 15% | Router + Store + API mock 组合 |
| E2E | 5% | 关键用户路径（登录 → 操作 → 退出） |

```ts
// apps/admin/src/components/__tests__/UserForm.test.ts
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import UserForm from "../UserForm.vue";

describe("UserForm", () => {
  it("renders email input", () => {
    const wrapper = mount(UserForm);
    expect(wrapper.find('input[type="email"]').exists()).toBe(true);
  });

  it("emits submit event with form data", async () => {
    const wrapper = mount(UserForm);
    await wrapper.find('input[type="email"]').setValue("test@example.com");
    await wrapper.find("form").trigger("submit.prevent");
    expect(wrapper.emitted("submit")?.[0][0]).toMatchObject({
      email: "test@example.com",
    });
  });
});
```

### 2.5 后端服务（`apps/server`）

| 测试类型 | 占比 | 说明 |
|---------|------|------|
| Unit | 60% | Services、Utils、Pipes、Guards |
| Integration | 35% | Controller + Service + MongoDB（Docker 或 memory） |
| E2E | 5% | 超级 Test agent 发包 |

NestJS 测试基础设施：

```ts
// apps/server/apps/api/src/modules/user/__tests__/user.service.spec.ts
import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { UserService } from "../user.service";
import { User } from "../user.schema";

describe("UserService", () => {
  let service: UserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getModelToken(User.name),
          useValue: {
            // Mock Mongoose model
            find: vi.fn().mockResolvedValue([]),
            findById: vi.fn(),
            create: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it("should find all users", async () => {
    const users = await service.findAll();
    expect(users).toEqual([]);
  });
});
```

> **NestJS + SWC 测试注意事项**：NestJS 的依赖注入依赖装饰器元数据（`emitDecoratorMetadata`）。SWC 编译器支持此特性（`swcCtx.config`），但 Vitest 默认的 esbuild 不支持。需要用 `unplugin-swc` 插件让 Vitest 用 SWC 编译 NestJS 代码。

---

## 3. 测试在 Monorepo 中的组织

### 3.1 测试文件位置

```
packages/utils/src/
├── queue/
│   ├── queue.ts
│   └── __tests__/
│       └── queue.test.ts      ← co-located with source
├── regex/
│   ├── regex.ts
│   └── __tests__/
│       └── regex.test.ts
```

**行业偏好**：test 文件与源码 co-located（`__tests__/` 目录），而不是独立的 `tests/` 顶层目录。这样删除源码时能顺带删除测试，不会留下孤立的 test 文件。

### 3.2 根目录统一命令 vs 按包运行

```jsonc
// 根 package.json
{
  "scripts": {
    "test": "turbo test",
    "test:watch": "turbo test:watch",
    "test:coverage": "turbo test:coverage"
  }
}
```

每个包自己定义 test command：

```jsonc
// packages/utils/package.json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

```jsonc
// apps/server/package.json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "vitest run --config vitest.e2e.config.ts"
  }
}
```

### 3.3 turbo.json 测试任务

```jsonc
{
  "tasks": {
    "test": {
      "dependsOn": ["^build"],   // 先确保依赖的 declaration 产出
      "outputs": ["coverage/**"],
      "inputs": ["src/**", "test/**", "**/*.test.*", "**/*.spec.*"]
    },
    "test:e2e": {
      "dependsOn": ["build"],     // E2E 需要完整产物
      "cache": false,             // E2E 不缓存（环境相关）
      "outputs": []
    },
    "test:coverage": {
      "dependsOn": ["test"],
      "outputs": ["coverage/**"]
    }
  }
}
```

---

## 4. 覆盖率策略

### 4.1 不追求 100%

业界共识：**覆盖率是一个信号，不是一个目标**。80% 是一个合理的 baseline：

| 包类型 | 覆盖率目标 | 说明 |
|--------|-----------|------|
| 纯工具 / 合约包 | 90%+ | 这些包逻辑密集、纯函数多，应该覆盖充分 |
| UI composables | 80%+ | 部分 DOM 相关逻辑难测 |
| Vue 组件 | 60%+ | 组件测试成本高，优先覆盖交互密集型 |
| NestJS controller | 50%+ | 很多样板（装饰器、模块声明）不值得测 |

### 4.2 全局覆盖率汇集

Vitest 的 workspace 模式可以一次性收集全仓库覆盖率：

```ts
// vitest.workspace.ts (root)
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/*",
  "apps/*",
]);
```

```bash
# 运行全仓库测试 + 覆盖率
pnpm vitest run --coverage --workspace
```

---

## 5. CI 中的测试执行

### 5.1 标准顺序

```yaml
- name: Unit tests (affected only)
  run: pnpm turbo test --filter='[origin/main]'

- name: Upload coverage
  uses: actions/upload-artifact@v4
  with:
    name: coverage
    path: coverage/
```

### 5.2 PR Comment with Coverage Diff

用 [Codecov](https://about.codecov.io/) 或 [Coveralls](https://coveralls.io/) 在 PR 上自动评论覆盖率变化：

```yaml
- name: Upload to Codecov
  uses: codecov/codecov-action@v4
  with:
    directory: ./coverage
    token: ${{ secrets.CODECOV_TOKEN }}
```

---

## 6. E2E 测试

### 6.1 工具选型

| 工具 | 适合场景 |
|------|---------|
| [Playwright](https://playwright.dev/) | 主流推荐，多浏览器，CI 友好 |
| [Cypress](https://www.cypress.io/) | Vue 生态好（Cypress Component Testing） |
| [Nightwatch](https://nightwatchjs.org/) | 老牌 |

### 6.2 放在 monorepo 的哪里

```
apps/admin/
├── e2e/                     ← 前端 E2E
│   ├── login.spec.ts
│   ├── dashboard.spec.ts
│   └── playwright.config.ts
└── src/
```

```jsonc
// apps/admin/package.json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui"
  }
}
```

**关键决策**：E2E 测试放在 `apps/admin/e2e/`（唯一依赖前端 app），**不建议**放在 monorepo 根目录——因为 E2E 只关心 admin 的行为，与 `packages/` 和 `apps/server` 无关。

---

## 7. 测试数据管理

### 7.1 后端集成测试的数据库策略

| 策略 | 优点 | 缺点 |
|------|------|------|
| **Docker MongoDB**（testcontainers） | 最接近生产，隔离好 | CI 需要 Docker |
| **MongoDB Memory Server**（mongodb-memory-server） | 不需要 Docker，速度快 | 与 MongoDB 真实行为有细微差异 |
| **Mock**（手动 mock Mongoose） | 极快，无外部依赖 | 与真实行为差得远 |

推荐：**优先 `mongodb-memory-server`**（开箱即用，CI 友好）。如果遇到行为不一致导致的假阳性 bug，再引入 testcontainers。

### 7.2 NODE_ENV

```jsonc
// apps/server/vitest.config.ts
export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",  // 强制 test 环境，避免误连生产 DB
    },
  },
});
```

---

## 8. 与 Walnut Admin 的映射

| 本文建议 | Walnut Admin 现状 | 差距 |
|---------|-------------------|------|
| Vitest 统一框架 | ✅ server 已有 vitest | 需推广到所有 packages |
| 共享 vitest preset | ❌ 未提取 | 可暂缓，包少时直接复制配置 |
| 按包类型分层策略 | ❌ 无明确策略 | 需制定覆盖率目标 |
| co-located 测试文件 | ❌ 现有测试位置不统一 | 建议统一 `__tests__/` 约定 |
| CI automated test | ❌ ADR-0009 待实现 | 待实现 |
| E2E | ❌ 无 | 非紧急——优先单元+集成覆盖 |
| 覆盖率报告（Codecov） | ❌ 未集成 | 免费，值得加 |
