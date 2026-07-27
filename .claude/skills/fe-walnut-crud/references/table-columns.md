# 表格列类型参考

WTable 所有可用的列类型。

## 基础列

```typescript
{
  key: 'fieldName',
  title: '列标题',
  width: 120,
  minWidth: 100,
  fixed: 'left',          // 固定列 'left' | 'right'
  ellipsis: { tooltip: true },
  sorter: true,
}
```

## Extend 类型

### 序号列
```typescript
{ key: 'index', extendType: 'index', fixed: 'left', width: 60 }
```

### 操作列
```typescript
{
  key: 'action',
  extendType: 'action',
  fixed: 'right',
  columnBuiltInActions: [
    {
      _builtInType: 'read',
      onPresetClick: (rowData) => { ... },
    },
    {
      _builtInType: 'delete',
      _dropdown: true,   // 放入下拉菜单
      onPresetClick: (rowData) => { ... },
    },
  ],
  columnExtraActions: [   // 自定义操作按钮
    {
      _builtInType: 'custom',
      buttonProps: { textProp: '自定义', type: 'primary' },
      onPresetClick: (rowData) => { ... },
    },
  ],
}
```

内置操作类型：`read` / `delete` / `create` / `detail`

### 字典列
```typescript
{
  key: 'status',
  extendType: 'dict',
  dictType: 'sys_shared_status',
  tagProps: (row) => ({ type: row.status ? 'success' : 'error' }),
}
```

### 标签列
```typescript
{
  key: 'category',
  extendType: 'tag',
  tagProps: (row) => ({ type: 'info', bordered: false }),
}
```

### 链接列
```typescript
{ key: 'email', extendType: 'link', onClick: (row) => openMailto(row.email) }
```

### 图标列
```typescript
{ key: 'icon', extendType: 'icon', extendIconName: 'mdi:account' }
```

## 预设列

```typescript
import {
  WTablePresetStatusColumn,
  WTablePresetOrderColumn,
  WTablePresetCreatedAtColumn,
  WTablePresetUpdatedAtColumn,
} from '@/components/UI/Table/src/utils/presetColumns'

// 直接展开到 columns 数组：
{ ...WTablePresetCreatedAtColumn, sorter: { multiple: 2, compare: 'default' } },
{ ...WTablePresetUpdatedAtColumn, defaultSortOrder: 'descend' },
```

## Action 按钮属性

| 属性 | 说明 |
|------|------|
| `_builtInType` | `'read'` / `'delete'` / `'create'` / `'detail'` |
| `_show` | `(row) => boolean` 控制显示 |
| `_disabled` | `(row) => boolean` 控制禁用 |
| `_dropdown` | `boolean` 放入下拉菜单 |
| `buttonProps.textProp` | 按钮文字 |
| `buttonProps.auth` | 权限字符串 |
| `iconProps.icon` | 图标名 |
| `onPresetClick` | `(rowData, rowIndex) => void` |

## 列格式化

```typescript
{ key: 'amount', formatter: (row, index) => `¥${row.amount.toFixed(2)}` }
```

## Table 关键属性

| 属性 | 说明 |
|------|------|
| `localeUniqueKey` | 国际化 key 前缀 |
| `rowKey` | 行唯一标识函数 `(row) => row._id` |
| `pagination` | 分页配置（pageSize, pageSizes） |
| `apiProps` | API 方法绑定（listApi, deleteApi） |
| `auths` | 权限声明（list, create, delete, deleteMany） |
| `polling` | 自动刷新间隔（毫秒） |
| `columnSetting` | 列显示设置开关 |
