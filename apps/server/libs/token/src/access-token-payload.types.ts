/**
 * JWT access token payload 构造的窄输入（libs 解耦批 4）。
 *
 * 原签名 `SysUserEntity & Partial<ISysUserPopulated>` 把 app 的 PG 实体与 user repo
 * 的 junction 读出形态拖进 lib；`getJwtAccessTokenPayload` 实际只读下面这几个字段，
 * 故以结构类型收窄（Tier 2 归档计划「Replace with plain interface」的落地）。
 * app 侧的 SysUserEntity（可带 roles_list junction 组装）结构上天然满足，调用点由
 * tsc 守护 —— 字段改名/增删会直接红在 app 的传参处。
 */
export interface IWalnutAdminAccessTokenPayloadInputRole {
  id: string
  roleName: string
}

export interface IWalnutAdminAccessTokenPayloadInput {
  id: string
  userName: string | null
  currentRole: string | null
  roleMode: string
  mfaSetup: boolean
  roles_list?: IWalnutAdminAccessTokenPayloadInputRole[]
}
