# <WPageTitle></WPageTitle>

项目 <WFrontLink path="/src/components">`components`</WFrontLink> 目录按 **功能分层** 规划了 7 个子文件夹，覆盖从通用能力到业务专属的组件体系：

:::info
- **目录结构**：每个组件的文档独立编写，按分类存放在对应子目录（如 `./advanced/`、`./app/`、`./business/`）。
:::

## 1. <WFrontLink path="/src/components/Advanced">`Advanced`</WFrontLink>：通用高级组件
**定位**：封装复杂交互逻辑的 **可配置型组件**，通过 Prop 注入接口等参数，实现跨场景复用。

| 组件名                                  | 功能说明                                                                             |
|-----------------------------------------|--------------------------------------------------------------------------------------|
| `ApiSelect`                             | 待重构，接口驱动的下拉选择器，内置虚拟列表、懒加载、回显等逻辑（接口通过 Prop 传入） |
| `CRUD`                                  | 一站式封装“增删改查”全流程（查询表单、数据表格、增编表单、列操作、导入导出等）       |
| `RoleSelect`                            | 待重构，基于 ApiSelect 二次封装的角色选择组件（直接传入角色列表接口，无额外逻辑）    |

## 2. <WFrontLink path="/src/components/App">`App`</WFrontLink>：应用级全局组件
**定位**：与 **应用全局状态/功能强绑定** 的组件，部分需配合后端接口实现核心能力（如权限、主题、国际化）。

| 组件名                                          | 功能说明                          |
|-------------------------------------------------|-----------------------------------|
| `AppAuthorize`                                  | 权限校验组件（控制页面/功能权限） |
| `AppDarkMode`                                   | 暗黑模式切换组件                  |
| `AppFullScreen`                                 | 全局全屏模式控制                  |
| `AppLocalePicker`                               | 国际化语言选择组件                |
| `AppLock`                                       | 应用锁屏组件（需接口同步状态）    |
| `AppNotAuthorized`                              | 无权限提示组件                    |
| `AppSearch`                                     | 全局搜索组件（依赖搜索接口）      |
| `AppSettings`                                   | 应用设置面板（主题、布局等配置）  |

## 3. <WFrontLink path="/src/components/Business">`Business`</WFrontLink>：业务强关联组件
**定位**：**与具体业务接口深度绑定** 的组件，脱离接口无法独立运行（如地区级联、头像上传、业务字典）。

| 组件名                                      | 功能说明                              |
|---------------------------------------------|---------------------------------------|
| `AreaCascader`                              | 地区级联选择组件（依赖地区数据接口）  |
| `AvatarUpload`                              | 头像上传组件（依赖头像管理接口）      |
| `Cap`                                       | 业务专属组件（需结合场景解释，暂略）  |
| `Dict`                                      | 业务字典展示/编辑组件（依赖字典接口） |
| `DictLabel`                                 | 字典值转标签组件（关联 Dict 组件）    |
| `ForceQuit`                                 | 强制退出组件（依赖权限状态接口）      |
| `LangSelect`                                | 语言选择组件（与国际化接口绑定）      |

## 4. <WFrontLink path="/src/components/Extra">`Extra`</WFrontLink>：通用辅助组件
**定位**：覆盖工具类、交互增强、格式处理等场景的 **通用辅助组件**，补充主流程外的多样化能力。

| 组件名                                                    | 功能说明                                                  |
|-----------------------------------------------------------|-----------------------------------------------------------|
| `AbsImage`                                                | 抽象image组件，支持通过blob、base64等多种方式获取图片资源 |
| `Arrow`                                                   | 通用箭头组件                                              |
| `CapsLockTooltip`                                         | 检测CapsLock状态并提示的工具组件                          |
| `Copy`                                                    | 一键复制组件                                              |
| `CountryCallingSelect`                                    | 国家区号选择组件                                          |
| `DemoCard`                                                | 演示用卡片组件                                            |
| `EmailInput`                                              | 邮箱格式校验输入框                                        |
| `Eyedropper`                                              | 取色器组件                                                |
| `Flipclock`                                               | 翻转时钟组件                                              |
| `Flipper`                                                 | 翻转切换组件                                              |
| `IconPicker`                                              | 图标选择器                                                |
| `JSON`                                                    | JSON可视化组件                                            |
| `LocaleSelect`                                            | 多语言词条选择组件                                        |
| `Message`                                                 | 轻量化的提示消息组件                                      |
| `Password`                                                | 密码输入增强组件                                          |
| `PhoneNumberInput`                                        | 手机号格式校验输入框，支持国际化                          |
| `QRCode`                                                  | 二维码生成组件，基于naive-ui封装                          |
| `Scrollbar`                                               | 滚动条组件，基于naive-ui封装                              |
| `TextScroll`                                              | 文本滚动组件                                              |
| `Title`                                                   | 标题增强组件                                              |
| `Transition`                                              | 过渡动画组件                                              |
| `TransitionSelect`                                        | 动画选择器                                                |
| `VerifyCode`                                              | 验证码输入组件                                            |

## 5.  <WFrontLink path="/src/components/HOC">`HOC`</WFrontLink>：高阶组件（待补充）
**定位**：通过高阶函数封装 **业务逻辑或交互模式** 的复用型组件（如权限包裹、异步加载、状态增强等）

| 组件名    | 功能说明                                       |
|-----------|------------------------------------------------|
| WithValue | v-model:value的拦截，支持自定义value的格式转换 |

## 6. <WFrontLink path="/src/components/UI">`UI`</WFrontLink>：原子化基础组件
**定位**：构成界面的 **原子化UI单元**，覆盖按钮、表单、弹窗等基础交互，提供统一视觉风格和交互规范，都是基于naive-ui原有组件上的二次封装。

| 组件名                                  | 功能说明     |
|-----------------------------------------|--------------|
| `Button`                                | 基础按钮组件 |
| `ButtonConfirm`                         | 确认按钮组件 |
| `ButtonGroup`                           | 按钮组容器   |
| `ButtonRetry`                           | 重试按钮组件 |
| `Card`                                  | 卡片组件     |
| `Checkbox`                              | 复选框组件   |
| `ColorPicker`                           | 颜色选择器   |
| `DatePicker`                            | 日期选择组件 |
| `Descriptions`                          | 描述列表组件 |
| `Drawer`                                | 抽屉组件     |
| `Dropdown`                              | 下拉菜单组件 |
| `DynamicTags`                           | 动态标签组件 |
| `Form`                                  | 表单容器组件 |
| `Icon`                                  | 图标组件     |
| `IconButton`                            | 图标按钮组件 |
| `Input`                                 | 文本输入框   |
| `InputNumber`                           | 数字输入框   |
| `Modal`                                 | 模态弹窗组件 |
| `Radio`                                 | 单选框组件   |
| `Select`                                | 选择器组件   |
| `Switch`                                | 开关组件     |
| `Table`                                 | 表格组件     |
| `TimePicker`                            | 时间选择组件 |
| `Tree`                                  | 树形组件     |
| `TreeSelect`                            | 树形选择器   |

## 7. <WFrontLink path="/src/components/Vendor">`Vendor`</WFrontLink>：第三方依赖组件
**定位**：集成第三方库的 **封装型组件**，桥接外部依赖与项目技术体系，降低直连第三方 API 的复杂度。

| 组件名                                    | 功能说明                           |
|-------------------------------------------|------------------------------------|
| `CodeMirror`                              | CodeMirror 代码编辑器封装组件      |
| `Cropper`                                 | Cropper 图片裁剪组件               |
| `ECharts`                                 | ECharts 可视化图表组件             |
| `LocationPicker`                          | 地址选择组件（地图能力封装）       |
| `Mindmap`                                 | 思维导图组件                       |
| `OSSUpload`                               | OSS 文件上传组件                   |
| `SignPad`                                 | 手写签名板组件                     |
| `Tinymce`                                 | Tinymce 富文本编辑器封装组件       |
