# cap.js WASM（自托管资产）

- 版本：`@cap.js/wasm@0.0.6`
- 上游：<https://www.npmjs.com/package/@cap.js/wasm>（源码 <https://github.com/tiagorangel1/cap>，Apache-2.0）
- vendor 日期：2026-11-25
- 来源文件：`npm pack @cap.js/wasm@0.0.6` 解包后的 `browser/cap_wasm.js` 与
  `browser/cap_wasm_bg.wasm`（**逐字节原样**，未改动）
- 为什么自托管：cap-widget 在 `blob:` worker 里 `import(CAP_CUSTOM_WASM_URL)`，原来指向
  jsDelivr —— 离线（或 CDN 故障）时登录链路直接不可用；自托管后与 widget 本体一样同源加载。

## 升级时两个文件必须一起换

`cap_wasm.js` 是 wasm-bindgen 生成的 glue，内部用
`new URL('cap_wasm_bg.wasm', import.meta.url)` 取**同目录兄弟文件**。只换其中一个会得到
「glue 与 wasm 版本不匹配」或 404。`CAP_CUSTOM_WASM_URL`（`src/store/modules/component/comp-capjs.ts`）
指向的必须是 glue（`cap_wasm.js`），不是 `.wasm`。

## 校验值（sha256）

```text
e90c7d94e5be5a3ede1ba96e24f35e0238a94faac140cae83ee03956101e9f06  cap_wasm.js
4eb7b21e7cf87d2a5a0bb76380e9b758e959fd286943ce2209ea362b93cfee2d  cap_wasm_bg.wasm
```
