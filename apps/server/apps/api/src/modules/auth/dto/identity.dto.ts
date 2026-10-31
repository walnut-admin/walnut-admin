/**
 * 身份验证码 DTO —— libs 解耦批 6 随身份内核下沉
 * （`libs/identity/src/user_identity/dto/identity.dto.ts`）。
 * 本文件只做 re-export，保持 auth 侧既有 import 面不变（class 名不变 → schema 名不变）。
 */
export { IdentitySendDTO, IdentityVerifyDTO } from '@walnut-server/identity'
