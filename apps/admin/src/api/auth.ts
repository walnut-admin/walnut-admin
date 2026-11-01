import type { AuthSecretKeys, AuthTokenPayload } from '@walnut/api-types'
import type { AuthPermissions } from './types/frontend-shapes'
import { AuthRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

/**
 * @description Sign out
 */
export function signoutAPI() {
  return AppAxios.post({
    url: AuthRoutes.SIGNOUT,
  })
}

/**
 * @description Refresh accessToken use refreshToken
 */
export function refreshTokenAPI() {
  return AppAxios.post<AuthTokenPayload>({
    url: AuthRoutes.REFRESH,
  })
}

/**
 * @description Signin user permissions api
 */
export function getPermissionsAPI() {
  return AppAxios.get<AuthPermissions>({
    url: AuthRoutes.PERMISSIONS,
  })
}

/**
 * @description get baidu ak from backend
 */
export function getBaiduKeyAPI() {
  return AppAxios.get<AuthSecretKeys>(
    {
      url: AuthRoutes.KEYS,
      _autoDecryptResponseData: ['B'],
      _cache: true,
    },
  )
}
