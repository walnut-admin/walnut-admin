/**
 * sys_log_operate 的 jsonb 写入形态归一（B8，phase2 4.16 / Q7 定案）。
 *
 * 批 4：随操作日志拦截器迁入 `@walnut-server/utils`（原
 * `apps/api/src/modules/system/logs/operate/log.operate.jsonb.ts`），实现零改动。
 *
 * Mongo 时代 requestData / responseData 存 `JSON.stringify` 后的字符串；PG 侧两列
 * 收 jsonb，应用新增**直接写对象**。写前先做一轮 stringify → parse 往返：
 * - 往返成功 → `data` 带对象落 jsonb 列，`raw` 为 null；
 * - 序列化失败（循环引用 / BigInt 等）→ `data` 置 null，**原文旁路**：尽力文本化后
 *   落同表 `raw_request_data` / `raw_response_data` text 列（零丢失语义；无法
 *   stringify 的值只能 `String()` 化，如实降级）。
 *
 * 这与 ETL 侧的 parse 摸底是同一约定的两侧：存量 Mongo 字符串行由 ETL parse 入
 * jsonb、失败原文入 raw_*（Phase 4）；应用新增行由本函数保证行不因序列化失败整体丢失。
 */
export interface IWalnutPgJsonbPayload {
  data: Record<string, unknown> | null
  raw: string | null
}

export function toWalnutPgJsonbPayload(value: unknown): IWalnutPgJsonbPayload {
  try {
    // stringify 先做可序列化校验（循环引用 / BigInt 等在此抛出），parse 回来保证
    // 与 jsonb 落库形态一致（undefined → 'null'，数组等合法 JSON 原样放行）
    return {
      data: JSON.parse(JSON.stringify(value) ?? 'null') as Record<string, unknown>,
      raw: null,
    }
  }
  catch {
    return { data: null, raw: String(value) }
  }
}
