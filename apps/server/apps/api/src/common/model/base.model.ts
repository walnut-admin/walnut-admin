/**
 * DTO 元数据基座 —— libs 解耦批 6 随身份栈下沉到 `@walnut-server/identity`
 * （`libs/identity/src/shared/base.model.ts`）。本文件只做 re-export，
 * 保持 app 侧既有 `@/common/model/base.model` import 面（所有 DTO 基座类）不变。
 */
export { WalnutAdminCommonBasicModel } from '@walnut-server/identity'
