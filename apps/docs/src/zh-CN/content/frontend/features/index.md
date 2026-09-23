# 前端功能集成

> 本目录收录**某个具体依赖/能力的接入说明**（插件与库怎么接、接到哪、有什么坑），
> 与 [`base/`](../base/project) 的区别是：`base/` 讲框架底座（路由、状态、i18n、请求…），
> 这里讲**可替换的单个集成**。

## 收录状态

| 集成 | 状态 | 说明 |
|------|------|------|
| [google-analytics](./ga) | ✅ 已写 | Vite 插件注入 gtag + 运行时上报 Web Vitals（含两张流程图） |
| [sentry](./sentry) | 🚧 待写 | 错误监控（构建期插件与运行时初始化都在仓库里，见 [`base/plugin.md`](../base/plugin) 的「生产插件」一节） |
| [fingerprint](./fingerprint) | 🚧 待写 | 设备指纹（见 [`base/hooks.md`](../base/hooks)） |
| [html-to-image](./html-to-image) | 🚧 待写 | DOM 截图（见 [`base/vendor.md`](../base/vendor)） |
| [driver](./driver) | 🚧 待写 | 新手引导（见 [`base/vendor.md`](../base/vendor)） |
| [ali-oss](./ali-oss) | 🚧 待写 | 对象存储直传 |
| [untyper](./untyper) | 🚧 待写 | 打字机效果 |
| [21st](./21st) | 🚧 待写 | — |

> ⚠️ **「🚧 待写」的页面目前只有标题**。它们由 [`frontend/introduction.md`](../introduction) 链过来，
> 所以**保留**（删掉会让那些链接变成死链）—— 但请**不要**把它们逐个登记进侧边栏：
> 侧边栏里摆一排空页面比不登记更难用。写完一篇就把上表的状态改成 ✅。
>
> 这个「先占位、写一篇改一次」的做法与 [架构待办 P3-21](/content/monorepo/architecture-todo) 里
> 那 74 篇组件文档是同一类事，区别只在这里的入口已经收敛成一张表。
