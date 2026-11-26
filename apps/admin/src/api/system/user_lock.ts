import type { components, SystemUserLockStatus } from '@walnut/api-types'
import type { IStoreApp } from '@/store/types'
import { SystemEndpointRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

/**
 * 锁屏偏好写入（`PATCH /system/user/lock/preference`）。
 *
 * Q10（2026-11-27）：`lockPwdHash` 是明文入参，但网络形态必须是**请求信封**
 * （`base64(JSON{enc,key,iv,ct,tag})`）—— `_autoEncryptRequestData` 由请求拦截器在
 * 签名之前完成 AES-GCM + RSA-OAEP 加密，服务端 `@WalnutAdminDecoratorDecryptRequest`
 * 解回明文再进 DTO / bcrypt。别把 `_autoEncryptRequestData` 去掉：那会让锁屏密码以明文
 * 落进签名原文与网络抓包。
 */
export function updateLockPreferenceAPI(data: components['schemas']['SysUserLockPreferenceUpdateDto']) {
  return AppAxios.patch<boolean>(
    {
      url: SystemEndpointRoutes.USER_LOCK_PREFERENCE,
      data,
      _autoEncryptRequestData: ['lockPwdHash'],
    },
  )
}

// get lock status
export function getLockStatusAPI() {
  return AppAxios.get<SystemUserLockStatus>(
    {
      url: SystemEndpointRoutes.USER_LOCK_READ,
    },
  )
}

// lock
export function lockAPI(lockRoute: IStoreApp.LockRoute) {
  return AppAxios.patch<boolean>(
    {
      url: SystemEndpointRoutes.USER_LOCK,
      data: { lockRoute },
    },
  )
}

/**
 * 解锁当前设备（`PATCH /system/user/lock/unlock`）。
 *
 * security 模式必须带 `lockPwdHash`；default / idle 可以不传（免密解锁）。
 * 与偏好写入同一套信封规则（Q10）。
 */
export function unlockAPI(lockPwdHash?: string) {
  return AppAxios.patch<boolean>(
    {
      url: SystemEndpointRoutes.USER_LOCK_UNLOCK,
      data: lockPwdHash ? { lockPwdHash } : {},
      _autoEncryptRequestData: ['lockPwdHash'],
    },
  )
}

/**
 * 忘记锁屏密码兜底：OPAQUE 登录交换第 1 步（`POST /system/user/lock/verify/start`）。
 *
 * 服务端落 30s SERVER_STATE（`unlock` 命名空间），密码永不离开客户端；退避期内本端点
 * 也会直接 40000 + `meta.retryAfterSec`（客户端据此先显示倒计时）。
 */
export function verifyStartAPI(data: components['schemas']['SysUserLockVerifyStartDto']) {
  return AppAxios.post<string>(
    {
      url: SystemEndpointRoutes.USER_LOCK_VERIFY_START,
      data,
    },
  )
}

/**
 * 忘记锁屏密码兜底：OPAQUE 登录交换第 2 步（`POST /system/user/lock/verify/finish`）。
 *
 * 验证通过**就地解锁**（不签发 token、不新建会话）；失败 40103 + meta（failCount /
 * retryAfterSec），与锁屏密码解锁共用一套计次预算。
 */
export function verifyFinishAPI(data: components['schemas']['SysUserLockVerifyFinishDto']) {
  return AppAxios.post<boolean>(
    {
      url: SystemEndpointRoutes.USER_LOCK_VERIFY_FINISH,
      data,
    },
  )
}

/**
 * 管理员重置某用户的锁屏（`PUT /system/user/lock/reset/:userId`）。
 *
 * 权限 `system:user:lock:reset`（root 短路）；只解锁 + 清计次，不读不碰用户的锁屏密码。
 */
export function resetUserLockAPI(userId: string) {
  return AppAxios.put<boolean>(
    {
      url: `${SystemEndpointRoutes.USER_LOCK_RESET}/${userId}`,
    },
  )
}
