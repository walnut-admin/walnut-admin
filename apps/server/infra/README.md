# Infra 配置架构

本文档说明 NestJS + SWC 的配置架构设计。

## 目录结构

```
infra/
├── nest/           # Nest CLI 配置文件
│   ├── dev.json    # 开发环境
│   ├── stage.json  # 预发布环境
│   └── prod.json   # 生产环境
├── swc/            # SWC 编译器配置
│   ├── dev.swcrc   # 开发环境
│   ├── stage.swcrc # 预发布环境
│   └── prod.swcrc  # 生产环境
└── README.md       # 本文档
```

## 环境差异

> ⚠️ **产物目录按画像分离**（2026-09-23）：`prod` → `dist/`、`stage` → `dist-stage/`。
> **不要**把两者改回同一个目录 —— turbo 缓存命中时**不真跑构建**，而是按任务键把声明的
> `outputs` 重放回盘上；两条流程声明同一个产物面时，后跑的那次（含缓存重放）决定盘上留的是
> 哪一版，**且不会报错**。更直接的一层：`deleteOutDir: true` 会先把对方的产物**删掉**再写。
>
> ⚠️ **`outDir` 的真源是 tsconfig，不是 `nest/<环境>.json`**（2026-09-23 实测踩到）：
> 在 `nest/stage.json` 的顶层与项目级都写 `compilerOptions.outDir: "dist-stage"` 后，
> Nest 的 **SWC builder 完全忽略它** —— 编译产物照旧落 `dist/`（因为
> `apps/server/tsconfig.json` 里写着 `outDir: "./dist"`），**只有 `assets[].outDir` 生效**；
> 而 `deleteOutDir: true` 照样把 prod 的 `dist` 删了。正确做法是给 staging 一份自己的
> tsconfig（`apps/api/tsconfig.app.stage.json`，只覆盖 `outDir` 与 `tsBuildInfoFile`），
> 再让 `nest/stage.json` 的 `tsConfigPath` 指向它。
>
> 路径的**四处**同源声明（改一处必须改其余）：
> ① `apps/api/tsconfig.app.stage.json` 的 `outDir`（**真源**）；
> ② `nest/stage.json` 的 `tsConfigPath`（顶层与 `projects.api` **两处都要改**）与三条 `assets[].outDir`；
> ③ `package.json` 的 `start:stage`；
> ④ 根 `turbo.json` 的 `build:stage.outputs`。
> 门禁 `pnpm lint:turbo-cache` 会顺着 `tsConfigPath → extends` 链把 `outDir` 解出来核对这些。
>
> ⚠️ 另：`nest/*.json` 由 **Nest CLI 按严格 JSON 解析**（不是 JSONC）—— **别在里面写注释**，
> 否则构建直接报 `Expected property name or '}' in JSON`。所以本节的说明放在这里而不是配置里。

### 开发环境 (dev)
- **sourceMaps**: 启用（便于调试）
- **inlineSourcesContent**: 启用
- **watchAssets**: 启用（静态资源热更新）
- **minify**: 禁用

### 预发布环境 (stage)
- **sourceMaps**: 启用（便于排查问题）
- **inlineSourcesContent**: 禁用
- **watchAssets**: 禁用
- **minify**: 禁用
- **产物目录**: `dist-stage/`（内部仍是 `apps/api/src/` —— 那由 Nest monorepo 的 `root` 决定）

### 生产环境 (prod)
- **sourceMaps**: 禁用
- **watchAssets**: 禁用
- **minify**: 启用（基础压缩）
- **产物目录**: `dist/`

## 静态资源处理

静态资源通过 Nest CLI 的 `assets` 配置处理：

| 资源目录 | 说明 | 输出路径（prod / stage） |
|---------|------|------------------------|
| `i18n/**/*` | 国际化文件 | `dist/apps/api/src/i18n` · `dist-stage/apps/api/src/i18n` |
| `public/**/*` | 静态文件（图片等） | `dist/apps/api/src/public` · `dist-stage/apps/api/src/public` |
| `views/**/*` | 模板文件（邮件模板） | `dist/apps/api/src/views` · `dist-stage/apps/api/src/views` |

## 路径映射

SWC 配置中的 `jsc.paths` 与 tsconfig.json 保持一致：

- `@/*` → `./apps/api/src/*`
- `@walnut-server/config` → `./libs/config/src`
- `@walnut-server/const` → `./libs/const/src`
- `@walnut-server/db` → `./libs/db/src`
- `@walnut-server/utils` → `./libs/utils/src`
- `@walnut-server/types` → `./libs/types/src`
- `@walnut-server/decorators` → `./libs/decorators/src`
- `@walnut-server/pipes` → `./libs/pipes/src`
- `@walnut-server/exceptions` → `./libs/exceptions/src`
- `@walnut-server/context` → `./libs/context/src`

## 性能对比

| 编译方式 | 首次启动 | 热更新 | 适用场景 |
|---------|---------|--------|---------|
| ts-node (原配置) | 30-60s | 5-10s | 兼容性最好 |
| SWC | 5-10s | 1-2s | **推荐** |

## 故障排查

### 1. 静态资源未复制
检查 Nest CLI 配置中的 `assets` 配置，确保路径正确：
```json
{
  "include": "i18n/**/*",
  "outDir": "dist/apps/api/src",
  "watchAssets": true
}
```

### 2. 路径解析失败
检查 SWC 配置中的 `jsc.paths` 是否与 tsconfig.json 一致。

### 3. 装饰器元数据丢失
确保 SWC 配置包含：
```json
{
  "jsc": {
    "transform": {
      "legacyDecorator": true,
      "decoratorMetadata": true
    }
  }
}
```

## 命令速查

```bash
# 开发模式（SWC）
pnpm dev

# 构建预发布
pnpm build:stage

# 构建生产
pnpm build
```
