# ADR-0026: 请求签名原文跨端统一

**Date:** 2026-11-02
**Status:** Accepted

## Context

签名原文的构造有两份实现：`apps/server/libs/guards/src/guards/sign.guard.ts`（验证侧）与
`apps/admin/src/store/modules/app/app-security.ts`（生产侧）。上收前的对拍发现两处序列化
分歧 —— 前缀根路径的 query 形态、空序列化 query 的尾随问号 —— 两端在同一请求上签不到一起；
且两端都没有针对签名原文构造的单元测试（仅有端到端 API 测试间接覆盖），签名不一致的唯一
症状是线上 401。

## Decision 1: `@walnut/utils/sign-raw` 参数化纯函数

`packages/platform-any/utils-core/src/sign-raw.ts` 提供 `buildSignRaw(parts)`、
`splitPathAndQuery(url)` 与 `stripApiPrefix(path, prefix, version)`。拼接规则以 server 验证侧
的现行实现为准逐字节复刻：`METHOD|PATH(含 query)|扁平化 body 排序串|timestamp=…|nonce=…|ua=…`。

两端只负责收集 parts：

- server：从 `req` 取 method / url / body / headers，先剥 API 前缀再拆 path 与 query，query
  原文直接取自 `req.url`；
- admin：从 axios config 取 method / data / params，用 `splitPathAndQuery` 拆 `config.url`
  自带的 query（如 logger 的 `?page=N`），与序列化后的 params 合并后再传入。

HMAC 计算仍留在两端：server 用 Node `crypto`，admin 用 WebCrypto —— 密钥派生（HKDF、设备
AES Key、会话绑定）与运行时环境强相关，不适合下沉。

## Alternatives considered

- **维持两端各自实现 + fixture 对拍测试**：能发现分歧，但每个新边界仍要两端各改一次，上收收益
  降级为「测试覆盖」。
- **把 HMAC 计算也下沉到共享包**：不可行 —— Node `crypto` 与浏览器 WebCrypto 的密钥派生、
  会话/设备密钥获取方式不同，共享函数只能覆盖原文拼接这一层。

## Consequences

- 签名正确性由共享函数 + fixture 单测保证（`packages/platform-any/utils-core/src/sign-raw.test.ts`
  的 7 组逐字节用例 + 路径预处理断言），不再是两端口头约定。
- 两处既有不一致被修正：前缀根 query 形态、空序列化 query 形态 —— 修正方向均为与 server 对齐，
  admin 侧同步改了签名入口。
- `undefined` 字段的序列化边界仍是已知限制：admin 在 `JSON.stringify` 前签名，服务端丢弃该
  字段后原文不同（见 [libs 解耦残留](../plans/libs-decoupling-residuals.md)）。
- security.guard 的私有 `stripApiPrefix` 副本删除，统一走共享函数。
