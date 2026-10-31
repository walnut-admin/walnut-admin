import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm'

/** payload 的形状（对齐 schema 的 AppErrorPayload：{body,params,query} 各为 stringify 字符串） */
export interface IAppErrorPayload {
  body?: string
  params?: string
  query?: string
}

/**
 * app_error —— MongoDB `app_error` 集合的 PostgreSQL 实体（phase2 4.22）。
 *
 * - 只有 created_at，无 updated_at（schema `updatedAt: false`）。
 * - payload 按 Q7 定案收 jsonb，同表配 raw_payload text 旁路列（ETL parse 失败时原文零丢失）。
 * - user_id 松引用（Q3，审计保真），不建 FK。
 * - response_code 文档定 varchar(16)，取值域登记为 AppResponseCode const —— 注意该 const 实际是
 *   **数值型**（20000/40000/...），ETL 写入时需转 text；差异已在交付报告登记。
 */
@Index('idx_error_created_at', ['createdAt'])
@Entity({ name: 'app_error' })
export class AppErrorEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  @Column({ type: 'text', name: 'message', nullable: true })
  message: string | null

  @Column({ type: 'text', name: 'stack', nullable: true })
  stack: string | null

  @Column({ type: 'integer', name: 'status_code', nullable: true })
  statusCode: number | null

  @Column({ type: 'text', name: 'path', nullable: true })
  path: string | null

  // 同 4.16 的 method CHECK（七种 HTTP 方法），在 migration；可空对齐文档
  @Column({ type: 'varchar', length: 8, name: 'method', nullable: true })
  method: string | null

  // 任意请求头 → jsonb；DDL 默认 '{}'
  @Column({ type: 'jsonb', name: 'headers', default: () => '\'{}\'::jsonb' })
  headers: Record<string, unknown>

  // Q7 定案：ETL parse 入 jsonb，失败入旁路 raw_payload
  @Column({ type: 'jsonb', name: 'payload', nullable: true })
  payload: IAppErrorPayload | null

  // ETL 原文旁路列（Q7），raw_* 一律 text
  @Column({ type: 'text', name: 'raw_payload', nullable: true })
  rawPayload: string | null

  @Column({ type: 'text', name: 'error_type', nullable: true })
  errorType: string | null

  // 松引用
  @Index('idx_error_user')
  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId: string | null

  // 取值 = AppResponseCode const（数值语义，列型 text 形态见类注释）
  @Column({ type: 'varchar', length: 16, name: 'response_code', nullable: true })
  responseCode: string | null

  @Column({ type: 'text', name: 'response_msg', nullable: true })
  responseMsg: string | null

  @Column({ type: 'text', name: 'ip', nullable: true })
  ip: string | null

  // CHECK (IN ('development','stage','production')) 在 migration
  @Column({ type: 'varchar', length: 16, name: 'env', nullable: true })
  env: string | null

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date
}
