# 表单 Schema 类型参考

WForm 所有可用的 Schema 类型。

## Base UI 组件

### Base:Input
纯文本输入，支持 clearable、placeholder、onKeyupEnter。

### Base:InputNumber
数字输入，支持 min、max、defaultValue。

### Base:Select
下拉选择，options 格式：`[{ label: '显示', value: '值' }]`。

### Base:Radio
单选按钮组，options 同上。

### Base:Checkbox
多选框组，options 同上。

### Base:Switch
开关，用 `defaultValue` 设默认值。

### Base:DatePicker
日期选择，`type: 'date' | 'datetime' | 'daterange'`。

### Base:TimePicker
时间选择，`format: 'HH:mm:ss'`。

### Base:Tree
树形选择，`multiple: true` 支持多选。

### Base:TreeSelect
树形下拉选择。

### Base:DynamicTags
动态标签输入，`defaultValue: []`。

### Base:ColorPicker
颜色选择器。

## Extra 组件

### Extra:Password
密码输入框，支持 `progress`（强度指示）和 `capslock`（大小写提示）。

### Extra:VerifyCode
验证码输入，`target: 'email' | 'phone'`，`countDown` 倒计时秒数。

### Extra:EmailInput
邮箱输入，`suffixList` 提供快捷后缀（如 `['@gmail.com', '@qq.com']`）。

### Extra:PhoneNumberInput
手机号输入。

### Extra:IconPicker
图标选择器。

### Extra:LocaleSelect
语言选择器。

### Extra:TransitionSelect
过渡动画选择器。

## Business 组件

### Business:Dict
字典渲染，`dictType` 指定字典类型，`renderType: 'select' | 'radio' | 'checkbox'`。

### Business:AreaCascader
地区级联选择，`depth` 控制层级深度（1-省, 2-市, 3-区）。

## Extend 组件

### Extend:Query
查询表单的搜索 + 重置按钮，无额外配置。

### Extend:Divider
表单分隔线，`formProp.label` 为标题，`titlePlacement: 'left' | 'center'`。

### Extend:RoleSelect
角色选择器，支持 `multiple`。

## Vendor 组件

### Vendor:Tinymce
富文本编辑器，`height` 控制高度。

### Vendor:JSONEditor
JSON 编辑器。

## Raw 组件

### Raw:DynamicInput
动态输入列表，`defaultValue: []`。

### Raw:Slider
滑块，min/max 范围。

## 特殊类型

### Base:Render
自定义渲染，`componentProp.render: ({ formData }) => h('div', '...')`。

### Base:Slot
模板插槽，配合 `<template #slotField>` 使用。

## 通用 Form Prop 选项

| 选项 | 说明 |
|------|------|
| `path` | **必填** - model 字段路径 |
| `label` | 显示标签 |
| `labelHelpMessage` | 帮助提示 |
| `rule` | 验证规则（`true` = 基础规则） |
| `ruleType` | 验证类型：`'string'` / `'number'` / `'array'` |
| `locale` | 是否启用国际化标签 |

## 网格布局

```typescript
gridProp: {
  span: 12,      // 1-24 栅格
  offset: 0,     // 左侧偏移
  suffix: false, // 靠右吸附
}
```

## 可见性控制

```typescript
visibleProp: {
  vIf: (formData) => formData.type === 'special',
  vShow: true,
  visibleMode: 'auto-forward', // 'no-move' | 'auto-forward'
}
```
