import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm'

/**
 * sys_log_operate —— MongoDB `sys_log_operate` 集合的 PostgreSQL 实体（phase2 4.16）。
 *
 * - 追加型大表：PK 默认 **uuidv7()**（phase2 3.3 定案）；无 updated_at，时间列即 operated_at。
 * - title 按 Q10-a 定案随迁移收紧 NOT NULL（旧库空值由 ETL 预检拦截，phase2 7.3）。
 * - request_data / response_data 按 Q7 定案收 jsonb，同表配 raw_request_data / raw_response_data
 *   text 旁路列（ETL parse 失败时原文旁路，零丢失）；应用新增直接写 jsonb。
 * - user_id / device_id 松引用（Q3），不建 FK。
 * - 两处与 phase2 文档字面不一致、按其自述口径落地的点（详见交付报告）：
 *   1. operation 列文档写 varchar(16)，但同时注明「取值 = WalnutAdminConstDecoratorLogOperateType，
 *      migration 时以 const 为准生成」—— const 最长值 'auth.opaque.changePassword'（25 字符）
 *      超出 16，故按 const 口径放宽为 varchar(32)；
 *   2. action_type 的 CHECK 文档列了 8 个值，const 实际还有 REFRESH / AUTH —— CHECK 暂按文档
 *      8 值落地，const 差异已在报告中登记，待维护者定夺。
 */
@Index('idx_log_operate_at', ['operatedAt'])
@Entity({ name: 'sys_log_operate' })
export class SysLogOperateEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id: string

  // 业务标注，开发者定制
  @Column({ type: 'text', name: 'title' })
  title: string

  // CHECK (IN ('OTHER','CREATE','UPDATE','DELETE','DELETE_MANY','IMPORT','EXPORT','CLEAR')) 在 migration
  @Column({ type: 'varchar', length: 16, name: 'action_type' })
  actionType: string

  // 取值 = WalnutAdminConstDecoratorLogOperateType（<module>.<operation>），CHECK 以 const 为准在
  // migration；B8 勘误：列收 NULL —— crud 装饰器全量写面不传 operateType，运行时恒 undefined
  // （Mongo schema `default: null` 本就容 null，phase3-plan §6 B8 追加）
  @Column({ type: 'varchar', length: 32, name: 'operation', nullable: true })
  operation: string | null

  // CHECK (IN ('GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD')) 在 migration
  @Column({ type: 'varchar', length: 8, name: 'method', nullable: true })
  method: string | null

  @Column({ type: 'text', name: 'url', nullable: true })
  url: string | null

  // like 1.1/2.0
  @Column({ type: 'text', name: 'http_version', nullable: true })
  httpVersion: string | null

  @Column({ type: 'text', name: 'location', nullable: true })
  location: string | null

  @Column({ type: 'text', name: 'os', nullable: true })
  os: string | null

  @Column({ type: 'text', name: 'browser', nullable: true })
  browser: string | null

  @Column({ type: 'integer', name: 'status_code', nullable: true })
  statusCode: number | null

  // Q7 定案：jsonb（应用直写）；ETL parse 失败时本列 NULL、原文入 raw_request_data
  @Column({ type: 'jsonb', name: 'request_data', nullable: true })
  requestData: Record<string, unknown> | null

  @Column({ type: 'jsonb', name: 'response_data', nullable: true })
  responseData: Record<string, unknown> | null

  // ETL 原文旁路列（Q7），raw_* 一律 text
  @Column({ type: 'text', name: 'raw_request_data', nullable: true })
  rawRequestData: string | null

  @Column({ type: 'text', name: 'raw_response_data', nullable: true })
  rawResponseData: string | null

  // B8：属性名保持 Mongo 字段 `correspondingMS`（列名仍 corresponding_ms）——
  // DTO 链以 schema 属性名为元数据基座、前端按 `correspondingMS` 读取，
  // plainToInstance 按源属性名拷贝，实体属性名错位会让出参丢字段
  @Column({ type: 'integer', name: 'corresponding_ms', nullable: true })
  correspondingMS: number | null

  // 松引用
  @Index('idx_log_operate_user')
  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId: string | null

  // 快照列
  @Column({ type: 'text', name: 'user_name', nullable: true })
  userName: string | null

  // 松引用
  @Index('idx_log_operate_device')
  @Column({ type: 'text', name: 'device_id', nullable: true })
  deviceId: string | null

  @Column({ type: 'text', name: 'ip', nullable: true })
  ip: string | null

  // service.method
  @Column({ type: 'text', name: 'invoking_method', nullable: true })
  invokingMethod: string | null

  // schema 允许 null，保持可空（phase2 4.16）
  @Column({ type: 'boolean', name: 'success', nullable: true })
  success: boolean | null

  // 脱敏前照（decorator 已 maskSensitive）
  @Column({ type: 'jsonb', name: 'snapshot_before', nullable: true })
  snapshotBefore: Record<string, unknown> | null

  // 脱敏后照
  @Column({ type: 'jsonb', name: 'snapshot_after', nullable: true })
  snapshotAfter: Record<string, unknown> | null

  // 原 createdAt 改名
  @CreateDateColumn({ type: 'timestamptz', name: 'operated_at' })
  operatedAt: Date
}
