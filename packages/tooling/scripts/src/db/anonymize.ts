/**
 * 脱敏规则 —— 给「线上 → 开发」这条通道用（见文档站「环境之间的数据流动：三个通道」的通道 2）。
 *
 * ## 为什么按**键名**判而不是按集合路径
 *
 * 按 `sys_device.ip` 这种路径写，等于把 schema 抄一遍：字段一改、新集合一加，规则就静默失效
 * （而失效的表现是"本地调试时看到真实手机号"，没人会立刻发现）。按键名判定则跟着字段走，
 * 新增集合只要字段名同类就自动被覆盖。
 *
 * ## 掩码而不是删除
 *
 * 调试要的是**形状**（这是手机号吗、IP 是哪个网段、设备 ID 有多长），不是原值。所以：
 *
 * | 类型 | 掩码后 | 保留了什么 |
 * |------|--------|-----------|
 * | 邮箱 | `a***@example.com` | 域名与首字母（判断是哪个租户/是否内部邮箱） |
 * | 手机 | `138****1111` | 前 3 后 4（与业务日志对得上号） |
 * | IP | `203.0.*.*` | 网段（排查网络问题时够用） |
 * | 不透明串（哈希 / 设备 ID / 密钥 / 密文） | `<redacted:32>` | **长度**（形状变了会立刻看出来） |
 *
 * ## 与 `policy.ts` 的关系
 *
 * `policy.ts` 管「**哪些数据进仓**」（裁剪），本文件管「**进本地库之前把个人数据掩掉**」（脱敏）。
 * 两者都在 `db:export` 这条路上生效，但用途不同：前者是长期的仓库形态，后者是一次性的排障快照。
 * 导出时才套脱敏，**替换掉的是原值** —— 所以脱敏结果永远不该覆盖仓内 seed（CLI 里做了拦截）。
 */

/** 脱敏后统一用的占位前缀（长度信息很重要：能看出字段是否被截断过） */
export const REDACTED = 'redacted'

/**
 * 按键名判定要不要掩 —— 顺序有讲究：先判更具体的（`valueHash` 这种），再判宽泛的。
 *
 * 刻意**不**匹配 `name` / `title` / `userName` / `description`：那些是调试时真正要看的东西
 * （掩掉等于把数据变成不可用），而且它们本身不是个人标识符。
 */
export const SENSITIVE_KEY_PATTERNS: readonly RegExp[] = [
  /pass(word)?$/i,
  /secret/i,
  /ciphertext/i,
  /token/i,
  /credential/i,
  /(public|private)key/i,
  /hash$/i,
  /^email/i,
  /e?mail/i,
  /phone|mobile/i,
  /^ip$|^ipHistory$|^ipWhitelist$/i,
  /^device/i,
  /^location|^geo/i,
  /avatar/i,
]

/** 这个键名是不是敏感字段 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some(re => re.test(key))
}

/** 邮箱：保留首字母与域名 */
export function maskEmail(value: string): string {
  const at = value.lastIndexOf('@')
  if (at <= 0)
    return `<${REDACTED}:${value.length}>`
  return `${value[0]}***${value.slice(at)}`
}

/** 手机号：保留前 3 后 4（不足 7 位的整体掩掉） */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 7)
    return `<${REDACTED}:${value.length}>`
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`
}

/** IP：保留前两段（IPv4）或前两组（IPv6）；IPv6 补齐到 8 组，形状与原值一致 */
export function maskIp(value: string): string {
  if (value.includes(':')) {
    const head = value.split(':').slice(0, 2).join(':')
    // IPv6 是 8 组：前 2 组保留 + 6 组星号（写成 7 个会多出一组，实测被用例抓到）
    return `${head}:${Array.from({ length: 6 }).fill('*').join(':')}`
  }
  const parts = value.split('.')
  if (parts.length !== 4)
    return `<${REDACTED}:${value.length}>`
  return `${parts[0]}.${parts[1]}.*.*`
}

/**
 * 单个值的掩码（按值形态挑掩法；不认识的形态一律 `<redacted:长度>`）。
 *
 * 这个函数只该用在**敏感键**上，或者用在确认含 PII 的字符串上 —— 它会把短字符串也掩成
 * `<redacted>`。第一版把它用在所有数组/对象元素上，结果 `sys_role.menus: ['m1']` 被掩成
 * `<redacted>`（实测抓到的误伤，对照组当场红了）。
 */
export function maskValue(value: unknown): unknown {
  if (value === null || value === undefined)
    return value
  if (typeof value === 'number' || typeof value === 'boolean')
    return value
  if (Array.isArray(value))
    return value.map(maskValue)
  if (typeof value === 'object')
    return maskValueObject(value as Record<string, unknown>)
  if (typeof value !== 'string')
    return value

  const text = value
  if (text === '')
    return text
  if (looksLikeEmail(text))
    return maskEmail(text)
  if (looksLikePhone(text))
    return maskPhone(text)
  if (looksLikeIp(text))
    return maskIp(text)
  // 其余"看起来像标识符/密文"的串：长度才是调试需要的形状信息
  if (text.length >= 8)
    return `<${REDACTED}:${text.length}>`
  return `<${REDACTED}>`
}

/**
 * 敏感键**内部**的递归：它里面的每个标量都算敏感（例如 `ipHistory: ['203.0.113.7']`），
 * 所以直接逐个掩。
 *
 * 例外是**坐标**：`lat` / `lng` 降到一位小数（城市级）。全精度坐标等于精确住址，
 * 但直接掩掉又会让"这两个设备是不是同一个城市"这类排查没法做 —— 降精度是这里唯一说得通的中间态。
 */
function maskValueObject(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(doc)) {
    if (key === '_id' || key === '__v') {
      out[key] = value
      continue
    }
    if (/^(lat|lng|latitude|longitude)$/i.test(key) && typeof value === 'number') {
      out[key] = Math.round(value * 10) / 10
      continue
    }
    out[key] = maskValue(value)
  }
  return out
}

/** 只按**键名**递归：非敏感键上的普通值保持原样，但会往里找敏感键 */
function maskNode(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(maskNode)
  if (value !== null && typeof value === 'object')
    return maskDocument(value as Record<string, unknown>)
  return value
}

export function looksLikeEmail(text: string): boolean {
  return /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(text)
}

/**
 * 手机号判定刻意**收紧**：宽松的"7 位以上数字"会把 `1000000` 这种普通数字串也掩掉（误伤）。
 * 只认两种形态：带 `+` 国家码的，或中国手机号（`1[3-9]` 开头 11 位）。
 */
export function looksLikePhone(text: string): boolean {
  if (/^\+\d{1,3}[\s-]?\d{6,14}$/.test(text))
    return true
  return /^1[3-9]\d{9}$/.test(text.replace(/[\s-]/g, ''))
}

export function looksLikeIp(text: string): boolean {
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(text)
  const isIpv6 = text.includes(':') && /^[0-9a-f:]{6,}$/i.test(text)
  return isIpv4 || isIpv6
}

/**
 * 一份文档脱敏（返回新对象，不改原值）。三层判定：
 *
 * 1. **敏感键** → 值一律掩（含其内部的每个标量）；
 * 2. **普通键但值是 PII 形态**（邮箱 / 手机 / IP）→ 掩 —— 这条是兜底，实测抓到过：
 *    `sys_user_identity.value` 这个键名毫无提示性，里面装的却是明文邮箱与手机号；
 * 3. 其余 → 只往里递归找敏感键，**普通值一个字不改**（否则 `menus: ['m1']` 这种会被误伤）。
 */
export function maskDocument(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(doc)) {
    if (key === '_id' || key === '__v') {
      out[key] = value
      continue
    }
    if (isSensitiveKey(key)) {
      out[key] = maskValue(value)
      continue
    }
    if (typeof value === 'string' && (looksLikeEmail(value) || looksLikePhone(value) || looksLikeIp(value))) {
      out[key] = maskValue(value)
      continue
    }
    out[key] = maskNode(value)
  }
  return out
}

/** 一批文档脱敏 */
export function anonymizeDocs(docs: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return docs.map(maskDocument)
}

/**
 * 自检：这份文档里还有没有"看着像未脱敏个人数据"的值。
 *
 * 给门禁用 —— 让「规则」与 `lint:seed` 之间有条机械联系：一旦有人把带真实个人数据的集合放进仓，
 * 或有字段改名绕过了脱敏规则，这条检查会点名到具体字段路径。
 */
export function findUnmaskedPersonal(doc: Record<string, unknown>, prefix = ''): string[] {
  const hits: string[] = []
  for (const [key, value] of Object.entries(doc)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (value !== null && typeof value === 'object') {
      if (Array.isArray(value)) {
        value.forEach((v, i) => {
          if (v !== null && typeof v === 'object')
            hits.push(...findUnmaskedPersonal(v as Record<string, unknown>, `${path}[${i}]`))
        })
      }
      else {
        hits.push(...findUnmaskedPersonal(value as Record<string, unknown>, path))
      }
      continue
    }
    if (typeof value !== 'string' || !isSensitiveKey(key))
      continue
    // 允许的形态：空串、带 `*` 的掩码（邮箱/手机/IP）、`<redacted…>` 占位
    const masked = value === '' || value.includes('*') || value.startsWith(`<${REDACTED}`)
    if (!masked)
      hits.push(`${path}=${value.length > 24 ? `${value.slice(0, 24)}…` : value}`)
  }
  return hits
}
