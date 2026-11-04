/**
 * CAP（cap.js）时间语义的**唯一真源**。
 *
 * 为什么必须收在一处：`app.global.capjs.config` 的 `ttl` 被三个消费方按**三种单位**
 * 读过 —— cap.js `createChallenge({ expiresMs })` 要毫秒、Express `cookie.options.maxAge`
 * 要毫秒、Redis 缓存 `set({ ttl })` 要**秒**。历史上三处各写各的换算
 * （`ttl` / `ttl * 1000` / `Math.ceil(ttl / 1000)`），**不存在任何一个取值能让三处同时正确**。
 * 现在的口径：
 *
 * - **配置单位 = 秒**：后台设置表单、`db/seed/app_setting.json` 的 `"ttl": 3600` 都是秒，
 *   人写的那一侧就是权威单位；代码里出现 `3600000` 一律是错的。
 * - 三个消费方**只允许**经下面三个 `resolve*` 取换算结果，不许再自己 `* 1000` / `/ 1000`。
 * - 换算的单测钉子：`cap.spec.ts`（同源一致性 + 种子 3600 的手算值）。
 */

/**
 * cap.js token 本体寿命 = **20 分钟**（单位：秒）。
 *
 * 第三方**硬编码**，与传入的 `expiresMs` 无关：`@cap.js/server@4.0.5` 的
 * `redeemChallenge` 内写死 `const expires = Date.now() + 20 * 60 * 1000`
 * （`node_modules/.pnpm/@cap.js+server@4.0.5/node_modules/@cap.js/server/index.js:343`），
 * 而 `expiresMs` 只作用于 challenge 本身（同文件 :279）。本仓不可配、也不该配。
 */
export const WalnutAdminConstCapTokenLifetimeSeconds = 20 * 60

/**
 * `ttl` 的缺省值 = **3600 秒（1 小时）**。
 * 与 `apps/server/db/seed/app_setting.json` 的 `"ttl":3600` 逐字对齐 —— 代码默认值
 * 与种子值必须是同一个数，否则「空表部署」和「种子部署」又是两套行为（review CAP-1）。
 */
export const WalnutAdminConstCapTtlDefaultSeconds = 60 * 60

/**
 * 校验缓存 TTL 下限 = 1 秒。
 * `AppTechCacheService.set` 的 `ttl <= 0` 语义是**永不过期**（`cache.service.ts:103-109`），
 * 绝不能让一个畸形配置把 CAP 校验缓存变成永久放行。
 */
export const WalnutAdminConstCapCacheTtlMinSeconds = 1

/**
 * 把配置里的 `ttl` 归一成「秒」。
 *
 * 只管非数字 / 非有限 / 非正数（缺配置、JSON 写坏、`null`）→ 缺省值；
 * **不做毫秒猜测**：一旦保留「大于某阈值就除以 1000」的启发式，单位又会变回两个真源。
 * 存量数据里若有旧的毫秒值（`3600000`），按部署说明重播种子即可，不靠代码兜。
 */
export function normalizeCapTtlSeconds(ttl: unknown): number {
  // 先取整再判：0.5 秒既不该变成 0（challenge 立刻过期、缓存 ttl=0 变永不过期），
  // 也不该在原样返回后让 `Math.floor` 在下游再抹一次
  const seconds = Math.floor(typeof ttl === 'number' ? ttl : Number(ttl))

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return WalnutAdminConstCapTtlDefaultSeconds
  }

  return seconds
}

/**
 * challenge 有效期（毫秒）—— 给 `AppCapJS.createChallenge({ expiresMs })`。
 * 秒 → 毫秒。
 */
export function resolveCapChallengeExpiresMs(ttl: unknown): number {
  return normalizeCapTtlSeconds(ttl) * 1000
}

/**
 * `CAPJS_TOKEN` cookie 的 `maxAge`（毫秒）—— 给 Express `cookie.options.maxAge`。
 * 秒 → 毫秒（Express 的 maxAge 单位是毫秒，历史上这里被误当成「秒 → 再乘 1000」过一次）。
 */
export function resolveCapCookieMaxAgeMs(ttl: unknown): number {
  return normalizeCapTtlSeconds(ttl) * 1000
}

/**
 * 校验缓存 TTL（**秒**）—— 给 `AppTechCacheService.set({ ttl })`。
 *
 * 窗口 = `min(ttl, 20min)`。**为什么是 20 分钟**：cap.js 在 `redeemChallenge` 里把 token
 * 寿命写死成 20 分钟（见 {@link WalnutAdminConstCapTokenLifetimeSeconds} 的源码引用），
 * 缓存**不得长于** token 本体寿命 —— 否则缓存命中等于放行一枚 cap.js 已经不认的凭据
 * （review CAP-2：默认 1 小时缓存 > 20 分钟 token，中间 40 分钟全是这种放行）。
 * 反过来 `ttl` 配得比 20 分钟短时以 `ttl` 为准（配置想更严就让它更严）。
 */
export function resolveCapCacheTtlSeconds(ttl: unknown): number {
  const seconds = normalizeCapTtlSeconds(ttl)

  return Math.max(
    WalnutAdminConstCapCacheTtlMinSeconds,
    Math.min(seconds, WalnutAdminConstCapTokenLifetimeSeconds),
  )
}
