import { createHmac } from 'node:crypto'

/**
 * `cookie-parser` 签名 cookie 的**手写复刻**（API 级测试助手，不引依赖）。
 *
 * 镜像对象：`cookie-parser@1.4.7` 依赖的 `cookie-signature@1.0.6` 的 `sign(val, secret)` ——
 * 服务端经 `res.cookie(key, value, { signed: true })` 落盘、`cookieParser(secret)` 验签的
 * 就是这一套算法：
 *
 *     Cookie 头的值 = 's:' + val + '.' + HMAC-SHA256(val, secret).base64 去掉尾部 '='
 *
 * `secret` 取 `app.cookie.secret`（`CookieParserMiddleware` 里 `cookieParser(secret)` 的入参，
 * 见 `apps/server/apps/api/src/middleware/src/cookieParser.middleware.ts:13`）。
 *
 * 为什么必须与该库**逐字节一致**：服务端 `req.signedCookies[key]` 只有三种结局
 * （cookie-signature@1.0.6/index.js:36-43 + cookie-parser@1.4.7/index.js:129-182）：
 * - `s:` 开头且 HMAC 对得上 ⇒ 得到**原值字符串**（guard 拿到真值）；
 * - `s:` 开头但 HMAC 对不上 ⇒ 得到 **`false`**（`getWalnutAdminCookieString` 会归一成「缺失」）；
 * - 没有 `s:` 前缀 ⇒ 整条**从 `signedCookies` 里消失**（`val !== dec` 才收录）。
 *
 * 也就是说：想构造「**签名合法、内容非法**」的 cookie（B5 旧形态 64hex DEVICE_ID、
 * 与缓存不一致的 SIGN_TICKET、非 cap.js 形态的 CAPJS_TOKEN），只有把签名算对一条路；
 * 差一个字符就退回「缺失」路径，测的就不是原对象了（这正是本 helper 存在的理由）。
 *
 * 返回值可直接放进 `Cookie` 头（服务端会先 `decodeURIComponent` 再验签，裸 `s:` 与
 * express 落线的 `s%3A` 等价）；`sign` 与 `unsignCookieValue` 是同一套算法的两面。
 */
export function signCookieValue(secret: string, value: string): string {
  // cookie-signature 用标准 base64（含 +/），并去掉尾部填充 '='；分隔符是 '.'
  const mac = createHmac('sha256', secret).update(value, 'utf8').digest('base64').replace(/=+$/, '')

  return `s:${value}.${mac}`
}

/**
 * `sign` 的逆：把 Cookie 头里的值还原成**服务端 guard 看到的那份字符串**。
 *
 * 用途是断言侧比对：jar 里存的是 `Set-Cookie` 原样，而 express 的 `res.cookie` 会整条
 * `encodeURIComponent`（`s:` 落线变成 `s%3A`、cap.js token 的 `:` 变成 `%3A`），
 * 服务端 `cookie.parse` 再 `decodeURIComponent` 回来。所以要跟 Redis 缓存值逐字节比，
 * 必须先解 URI 再解签名 —— 顺序与服务端一致，且**两种形态都收**（`s:` 与 `s%3A`）。
 *
 * 返回 `undefined` 的两种情况与服务端语义对齐：没有 `s:` 前缀（会被 cookie-parser
 * 整条丢弃）与形态不完整（没有 `.` 分段）。
 */
export function unsignCookieValue(raw: string): string | undefined {
  let decoded = raw

  try {
    decoded = decodeURIComponent(raw)
  }
  catch {
    // 值里有非法百分号转义：保持原样，让下面的形态判定给出 undefined 而不是让断言侧抛
  }

  if (!decoded.startsWith('s:')) {
    return undefined
  }

  const payload = decoded.slice(2)
  const dot = payload.lastIndexOf('.')

  if (dot <= 0) {
    return undefined
  }

  return payload.slice(0, dot)
}
