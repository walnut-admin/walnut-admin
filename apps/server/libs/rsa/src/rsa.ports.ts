/**
 * App Key 存储端口（libs 解耦批 5 的依赖反转）。
 *
 * `SecurityRsaService` 的请求解密/响应加密都要从密钥材料里取 RSA 密钥对：
 * 公钥（下发给客户端）与私钥（仅服务端解密用）。此前直接注入 app 的 `AppKeyService`
 * （lib → app 反向依赖）；现在 libs/rsa 只依赖本端口，实现随 key 域落在 `libs/app-domain`，
 * 由该 lib 的 `AppKeyModule`（@Global）用
 * `{ provide: WALNUT_ADMIN_KEY_STORE, useExisting: AppKeyService }` 绑定实现，
 * `AppKeyService implements IWalnutAdminKeyStore` 作编译期守护。
 *
 * 端口刻意只收 rsa 服务实际用到的两个方法：
 * - `getCurrent`：HTTP 公开面（`{ publicKeyPem }`，私钥永不下发，P0-6）；
 * - `getCurrentActiveKey`：实体通道（`meta.privateKeyPem` 供服务端解密）。
 */
export const WALNUT_ADMIN_KEY_STORE = Symbol('WALNUT_ADMIN_KEY_STORE')

export interface IWalnutAdminKeyStore {
  getCurrent: (type: 'RSA_PAIR') => Promise<{ publicKeyPem?: string }>
  getCurrentActiveKey: (type: 'RSA_PAIR') => Promise<{ meta?: { privateKeyPem?: string } | null } | null>
}
