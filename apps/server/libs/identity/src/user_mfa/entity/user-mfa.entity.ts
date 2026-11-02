import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * sys_user_mfa —— MongoDB `sys_user_mfa` 集合的 PostgreSQL 实体（phase2 4.12）。
 *
 * - device_id 是对 sys_device.device_id 的**松引用**（Q5 定案：MFA 凭据不应随设备行删除
 *   而级联消失），不建 FK，仅保留 text 列。
 * - webauthn_credential_id 按 Q2 定案补 partial unique（凭据 id 全局唯一，可空列 → WHERE NOT NULL）。
 * - webauthn_counter 用 bigint（签名计数器语义上无上限）；pg 驱动对 int8 默认返回 string，
 *   这里挂 number transformer（webauthn 校验库的 counter 形参是 number）。
 * - 四个密文列对齐 schema 的 select: false（B7b 接线时补上，同 identity 的处理口径）：
 *   默认查询不出，取值走仓库的显式 addSelect 通道。
 */
@Index('idx_user_mfa_user', ['userId'])
@Entity({ name: 'sys_user_mfa' })
export class SysUserMfaEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string

  // CHECK (IN ('totp','webauthn')) 在 migration
  @Column({ type: 'varchar', length: 8, name: 'type' })
  type: string

  // 松引用 sys_device.device_id（不建 FK，Q5）
  @Column({ type: 'text', name: 'device_id' })
  deviceId: string

  @Column({ type: 'text', name: 'name' })
  name: string

  // TOTP 专用密文（schema select: false → 实体同款）
  @Column({ type: 'text', name: 'totp_secret_ciphertext', nullable: true, select: false })
  totpSecretCiphertext: string | null

  @Index('uq_user_mfa_credential', { unique: true, where: '"webauthn_credential_id" IS NOT NULL' })
  @Column({ type: 'text', name: 'webauthn_credential_id', nullable: true })
  webauthnCredentialId: string | null

  // WebAuthn 公钥（schema select: false → 实体同款）
  @Column({ type: 'text', name: 'webauthn_public_key', nullable: true, select: false })
  webauthnPublicKey: string | null

  // int8 → number（驱动默认返 string；counter 参与 webauthn 防重放比较，须为 number）
  @Column({
    type: 'bigint',
    name: 'webauthn_counter',
    default: 0,
    transformer: {
      from: (value: string | null): number => (value === null ? 0 : Number(value)),
      to: (value: number): number => value,
    },
  })
  webauthnCounter: number

  // 数组元素 CHECK（IN usb/ble/nfc/internal/hybrid）在 migration，用数组包含谓词实现
  @Column({ type: 'text', name: 'webauthn_transports', array: true, default: () => '\'{}\'' })
  webauthnTransports: string[]

  // SMS 专用密文（schema select: false → 实体同款）；SMS MFA 未实现 —— 预留列，无写入路径（P3-23）
  @Column({ type: 'text', name: 'phone_number_ciphertext', nullable: true, select: false })
  phoneNumberCiphertext: string | null

  // 备用码密文（schema select: false → 实体同款）。
  // P3-23（2026-10-29）：每项 = AES-GCM(SHA-256(固定域:userId:code)) —— 确定性哈希才能
  // 与用户输入比对（旧随机盐 HMAC 的存量项不可解密，需 unbind 后重新 bind）。
  @Column({ type: 'text', name: 'backup_codes_ciphertext', array: true, default: () => '\'{}\'', select: false })
  backupCodesCiphertext: string[]

  @Column({ type: 'boolean', name: 'status', default: true })
  status: boolean

  @Column({ type: 'timestamptz', name: 'last_used_at', nullable: true })
  lastUsedAt: Date | null

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
