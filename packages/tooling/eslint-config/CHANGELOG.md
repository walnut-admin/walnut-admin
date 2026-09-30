# @walnut/eslint-config

## 0.1.0

### 新功能

- [`23d63c4`](https://github.com/walnut-admin/walnut-admin/commit/23d63c45a35f30da6fe2971d3fda58051e3169a2) by @Zhaocl1997 **tooling** 接 eslint-plugin-turbo，未声明的环境变量不再被静默剥离
- [`b88227d`](https://github.com/walnut-admin/walnut-admin/commit/b88227d0d035da8d71764f15874e08f4a5d90c50) by @Zhaocl1997 **eslint-config** 两条脚本入口规则（文件头 / 退出码三态）+ 本包第一套测试
- [`f0f2636`](https://github.com/walnut-admin/walnut-admin/commit/f0f2636d86b7c7d1783bba4ab241bcbb316348de) by @Zhaocl1997 **tooling** 新增本地规则「注释里不许有 emoji」+ 全仓清理存量
- [`7426bfc`](https://github.com/walnut-admin/walnut-admin/commit/7426bfcf4d0068c4fb97feda2e446418231c3192) by @Zhaocl1997 **tooling** 新增 `pnpm lint:emoji` —— 注释里不许有 emoji（跨所有被跟踪文本文件）+ 常驻文档去 emoji

### 修复

- [`d4089e3`](https://github.com/walnut-admin/walnut-admin/commit/d4089e3254de4b0379cd8446a467ae641cc74932) by @Zhaocl1997 **tooling** lint 的 --concurrency=auto 换成固定 4（12 worker 偶发 0xC0000005）
- [`ce60ac0`](https://github.com/walnut-admin/walnut-admin/commit/ce60ac0097864560cd84010999a06f6c27ea60ce) by @Zhaocl1997 **tooling** 规则误伤版权符号 —— 豁免 © ® ™ 并恢复被改掉的 JSDoc
