import vueConfig from '@walnut/eslint-config/vue'

// `public/vendor/**` = **随前端分发的第三方运行时文件**（codeMirror 语言包、tinymce 全家桶），
// 原样搬运、不参与本仓的风格规则：
//   · tinymce 一批**未压缩**的产物（`plugins/emoticons/js/emojis.js`、`plugins/help/js/i18n/keynav/*.js`）
//     一进扫描面就是 ~7.4 万条 `style/*` 报错（2026-11 批次 4 · D20 把它们从
//     `apps/server/apps/api/src/public/js/` 搬来时的实测）；
//   · 它们**不是我们的代码**，改一行都会在下次升级 tinymce 时被覆盖 ⇒ 修 lint 没有意义，
//     唯一正确的处置是不扫。
// 注意：只忽略 vendor 目录，`public/` 下的自有资产（`assets/css/*.css` 等）照旧受检。
export default vueConfig({ ignores: ['public/vendor/**'] })
