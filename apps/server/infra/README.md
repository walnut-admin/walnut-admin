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

### 生产环境 (prod)
- **sourceMaps**: 禁用
- **watchAssets**: 禁用
- **minify**: 启用（基础压缩）

## 静态资源处理

静态资源通过 Nest CLI 的 `assets` 配置处理：

| 资源目录 | 说明 | 输出路径 |
|---------|------|---------|
| `i18n/**/*` | 国际化文件 | `dist/apps/api/src/i18n` |
| `public/**/*` | 静态文件（图片等） | `dist/apps/api/src/public` |
| `views/**/*` | 模板文件（邮件模板） | `dist/apps/api/src/views` |

## 路径映射

SWC 配置中的 `jsc.paths` 与 tsconfig.json 保持一致：

- `@/*` → `./apps/api/src/*`
- `@walnut/config` → `./libs/config/src`
- `@walnut/const` → `./libs/const/src`
- `@walnut/db` → `./libs/db/src`
- `@walnut/utils` → `./libs/utils/src`
- `@walnut/types` → `./libs/types/src`
- `@walnut/decorators` → `./libs/decorators/src`
- `@walnut/pipes` → `./libs/pipes/src`
- `@walnut/exceptions` → `./libs/exceptions/src`
- `@walnut/context` → `./libs/context/src`

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
