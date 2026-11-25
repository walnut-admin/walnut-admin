/**
 * 日志 / 失败现场附件的**脱敏**：把敏感 header 与凭据形态的值换成占位符。
 *
 * 两个消费者，格式完全不同（多行日志文本 vs JSON 对象），但必须用**同一份规则**：
 * - `scripts/start-backend.ts`：后端进程的 stdout/stderr 落盘前逐行脱敏；
 * - `tests/fixtures.ts`：失败用例 attach 的 stack / 基线清单 / 最近 envelope 投影。
 * 两处各写一套规则的结局是「同一类值在一处被杀、另一处漏出去」，而漏出去的那份要上传。
 *
 * 口径是**宁可多杀不可漏**：按「字段名 → 值」匹配（不靠猜值的形态），再用形态兜底
 * （JWT / `d1_` 设备 id / `s:` 签名 cookie）。多杀一个数字只影响可读性，漏一个 token
 * 就是 artifact 泄漏。因此这里**不做白名单**，只做黑名单；新增敏感名时优先加一条，而不是改规则。
 *
 * 为什么不是「只保留安全字符」那种清洗：脱敏后的日志仍要能读（业务码、URL 路径、错误消息），
 * 否则排障还是会回到「登录 runner 复现」。
 *
 * 注意：规则是**行内**的（值不跨换行）—— 调用方先把流切成整行再调用，半个 token 跨行拼接
 * 会让正则匹配不到，这也是 `start-backend.ts` 做行缓冲的原因。
 */

/** 占位符（测试与调用方共用；别在别处另写一份字面量） */
export const REDACTED = '<redacted>'

/**
 * 敏感 header 名（大小写不敏感）。`cookie` 一杀就是一串 cookie 都安全。
 *
 * **顺序有意义**：前缀关系的名字必须长的在前（`set-cookie` 先于 `cookie`、`x-sign-ticket`
 * 先于 `x-sign`），否则正则会从短名字处切开、把名字本身也弄得半截。
 */
const SENSITIVE_HEADER_NAMES = [
  'authorization',
  'proxy-authorization',
  'www-authenticate',
  'set-cookie',
  'cookie',
  'x-sign-ticket',
  'x-sign',
  'x-csrf-token',
  'csrf-token',
  'x-auth-token',
].join('|')

/**
 * 敏感字段名（query / body / JSON key）。含 `token` 这类泛名字是有意的：
 * 本仓的 CAP token / access token / refresh token 都落在这些名字上，误杀一个普通 `token`
 * 字段的代价远小于漏一个。
 */
const SENSITIVE_FIELD_NAMES = [
  'password',
  'passwd',
  'pwd',
  'access_token',
  'refresh_token',
  'id_token',
  'cap_token',
  'capjs_token',
  'capToken',
  'totp',
  'otp',
  'token',
  'secret',
  'session',
  'sid',
  'private_key',
  'privatekey',
  'client_secret',
  'api_key',
  'apikey',
].join('|')

/** 值形态（header）：双引号串（可含转义）/ 单引号串（`util.inspect` 的形态）/ 裸值（到结构分隔符） */
const HEADER_VALUE_PATTERN = String.raw`(?:"(?:[^"\\\n]|\\.)*"|'[^'\n]*'|[^,\n}\]]+)`

/**
 * 值形态（字段 / query）：比 header 多停几处 —— `&`（下一个查询参数）、`;`（下一个 cookie /
 * 声明）、空白、`{`（对象结构，不是凭据）。字段值里不会真有这些字符，停在这里能把
 * 「后面还有用的日志」保留下来。
 */
const FIELD_VALUE_PATTERN = String.raw`(?:"(?:[^"\\\n]|\\.)*"|'[^'\n]*'|[^\s,}\]&;{]+)`

/** 名字允许被引号包住（`"x-sign"` / `'x-sign'` 都是常见形态）；顺序有意义，见上面注释 */
const NAME_PATTERN = `['"]?(?:${SENSITIVE_HEADER_NAMES})['"]?`

/**
 * `name: value` / `name=value`（header 行、`util.inspect` 对象、JSON 都命中）。
 *
 * 空白写在**值**那一侧（`[:=]` 之后）：这样捕获组里没有 `\s*`，`regexp/no-misleading-...`
 * 那条规则（`\s*` 与后面的值类可交换字符）不会误报；代价只是替换后少一个空格。
 */
const HEADER_ASSIGNMENT = new RegExp(
  `(${NAME_PATTERN}\\s*[:=])\\s*${HEADER_VALUE_PATTERN}`,
  'gi',
)

/** 敏感字段名 → 值 */
const FIELD_ASSIGNMENT = new RegExp(
  `(['"]?(?:${SENSITIVE_FIELD_NAMES})['"]?\\s*[:=])\\s*${FIELD_VALUE_PATTERN}`,
  'gi',
)

/**
 * cookie 串里单独出现的敏感键（`DEVICE_ID=…; CAPJS_TOKEN=…`）。
 * 值止于 `;` 或空白 —— cookie 的分隔符，不会吃进下一个键。
 */
const COOKIE_ASSIGNMENT = /\b(DEVICE_ID|CAPJS_TOKEN|SIGN_TICKET|RT_JTI|AT_JTI|ACCESS_TOKEN|REFRESH_TOKEN)\s*=\s*[^;\s&'"}\],]+/gi

/** `Bearer <token>`（Authorization 值已被整段杀掉，这里兜底「裸写在消息里」的形态） */
const BEARER_TOKEN = /\bBearer\s+[\w.~+/=-]{6,}/gi

/** JWT（三段 base64url，头是 `{"` 的 base64）—— 即使出现在句子中间也杀 */
const JWT_TOKEN = /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}/g

/** 设备 id（服务端签发形态 `d1_` + 32 hex）：日志里裸出现也算敏感（cookie 值的一半） */
const DEVICE_ID_VALUE = /\bd1_[0-9a-f]{32}\b/g

/** `s:` 签名 cookie 值（`s:<payload>.<signature>`）—— 没有 id 前缀的兜底 */
const SIGNED_COOKIE_VALUE = /\bs:[\w+/-]{16,}\.[\w+/=-]{8,}/g

/**
 * 文本脱敏（单行；多行输入也能用，只是值不跨行匹配）。幂等：脱敏结果再跑一遍不变。
 */
export function redactText(input: string): string {
  return input
    .replace(HEADER_ASSIGNMENT, `$1${REDACTED}`)
    .replace(FIELD_ASSIGNMENT, `$1${REDACTED}`)
    .replace(COOKIE_ASSIGNMENT, `$1=${REDACTED}`)
    .replace(BEARER_TOKEN, `Bearer ${REDACTED}`)
    .replace(JWT_TOKEN, REDACTED)
    .replace(DEVICE_ID_VALUE, REDACTED)
    .replace(SIGNED_COOKIE_VALUE, REDACTED)
}

/** 敏感 key 名（`redactDeep` 用：值整段丢弃，不看过不过得了文本规则） */
const SENSITIVE_KEY = new RegExp(
  `^(?:${SENSITIVE_HEADER_NAMES}|${SENSITIVE_FIELD_NAMES}|device_id|rt_jti|at_jti|deviceid|sign_ticket)$`,
  'i',
)

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 结构化数据脱敏（深拷贝，不改入参）：字符串值过 {@link redactText}，敏感 key 的值整段换成
 * 占位符，其余类型原样保留。
 *
 * 为什么 attach 用这个而不是「先 JSON.stringify 再 redactText」：后者会把
 * `"x-sign": "abc"` 变成 `"x-sign": <redacted>` —— 不再是合法 JSON，下载附件的人打不开。
 */
export function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactText(value)
  }
  if (Array.isArray(value)) {
    return value.map(item => redactDeep(item))
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactDeep(item)
    }
    return out
  }
  return value
}
