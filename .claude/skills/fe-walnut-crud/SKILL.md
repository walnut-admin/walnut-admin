---
name: CRUD 页面开发
description: Walnut Admin Client CRUD 页面开发模式。基于 WCRUD + useCRUD hook 的 Schema 驱动 CRUD 页面开发。
when_to_use: 新建 CRUD 页面、列表页、表单页、数据管理页面、增删改查页面
paths:
  - apps/admin/**
---

# CRUD 页面开发

## 核心约束

1. **必须**用 `WCRUD` 组件 + `useCRUD` hook，**禁止**手写 Table + Form 拼装
2. Table 列和 Form 字段**必须**通过 schema 配置定义，**禁止**模板标记
3. API **必须**继承 `BaseAPI<T>`
4. 权限必须通过 `auths` 对象声明

## useCRUD 关键配置

| 配置 | 说明 |
|------|------|
| `baseAPI` | 继承 BaseAPI 的实例 |
| `strictFormData: true` | 只提交 schema 中定义的字段 |
| `safeForm: true` | 启用未保存变更确认 |
| `tableProps` | Table 配置（columns, queryFormProps, auths） |
| `formProps` | Form 配置（schemas, dialogPreset） |

## Schema 驱动核心

- Form schema type 格式：`{Category}:{ComponentName}`（如 `Base:Input`、`Business:Dict`、`Vendor:Tinymce`）
- Table column 用 `extendType` 标识特殊列：`index` / `action` / `dict` / `tag` / `link`
- 内置 action button：`read` / `delete` / `create` / `detail`
- 查询表单用 `{ type: 'Extend:Query' }` 生成搜索+重置按钮
- 国际化通过 `localeUniqueKey` 自动推导 `form.{key}.{field}` 和 `table.{key}.{field}`

## 常见错误

- 不设 `strictFormData: true` → 提交了不该提交的字段
- 忘记 `safeForm: true` → 用户编辑后误关弹窗无提示
- 手写 Table 组件的 columns → 失去 preset columns 和 内置 action
- API 不继承 BaseAPI → `useCRUD` 的标准 CRUD 操作无法工作

## 详细参考

- 表单 Schema 类型：`references/form-schemas.md`
- 表格列类型：`references/table-columns.md`
