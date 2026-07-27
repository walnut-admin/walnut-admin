# Walnut Admin NestJS Server - Agent Guide

> **导航文档** - 快速找到你需要的详细指南

## 📚 文档索引

| 文档 | 内容 | 适用场景 |
|------|------|----------|
| [01_PROJECT_OVERVIEW](./.agents/docs/01_PROJECT_OVERVIEW.md) | 项目概述、技术栈、功能特性 | 了解项目全貌 |
| [02_PROJECT_STRUCTURE](./.agents/docs/02_PROJECT_STRUCTURE.md) | 目录结构、文件命名规范 | 熟悉代码组织 |
| [03_BUILD_AND_DEV](./.agents/docs/03_BUILD_AND_DEV.md) | 构建命令、开发流程 | 日常开发 |
| [04_CODE_STYLE](./.agents/docs/04_CODE_STYLE.md) | ESLint 规则、TS 规范 | 代码规范 |
| [05_MODULE_ARCHITECTURE](./.agents/docs/05_MODULE_ARCHITECTURE.md) | 模块架构概览 | 理解模块设计 |
| [06_REPOSITORY_PATTERNS](./.agents/docs/06_REPOSITORY_PATTERNS.md) | 三种 Repository 模式详解 | 数据访问层开发 |
| [07_SERVICE_LAYER_RULES](./.agents/docs/07_SERVICE_LAYER_RULES.md) | 服务层架构规则 | Service 层开发 |
| [08_CRUD_DECORATORS](./.agents/docs/08_CRUD_DECORATORS.md) | CRUD 装饰器使用 | 控制器开发 |
| [09_SECURITY_GUARDS](./.agents/docs/09_SECURITY_GUARDS.md) | Guard 体系、执行顺序 | 安全相关开发 |
| [10_DATABASE_SETUP](./.agents/docs/10_DATABASE_SETUP.md) | MongoDB/Redis 配置 | 数据库配置 |
| [11_TESTING_GUIDE](./.agents/docs/11_TESTING_GUIDE.md) | 测试指南 | 编写测试 |
| [12_ENVIRONMENT_CONFIG](./.agents/docs/12_ENVIRONMENT_CONFIG.md) | 环境变量 | 配置管理 |
| [13_UTILITIES](./.agents/docs/13_UTILITIES.md) | 工具脚本 | 使用工具 |
| [14_TROUBLESHOOTING](./.agents/docs/14_TROUBLESHOOTING.md) | 常见问题 | 解决问题 |

## 🚀 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量（复制 env/.env.development 并修改）
cp env/.env.development env/.env.local

# 3. 启动开发服务器
pnpm dev
```

访问 http://localhost:3000/api 查看 Swagger 文档

## 📖 更多资源

- **Skill 指南**: `.claude/skills/` 目录下包含可复用的开发技能（`be-*` 前缀为后端，`fe-*` 前缀为前端）
- **项目结构**: 源码位于 `src/walnut/admin/com/app/`
- **API 文档**: 开发环境自动生成的 Swagger UI

---

*最后更新: 2026-02-24*
