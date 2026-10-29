import type { AuthSecretKeys, AuthTokenPayload } from '@walnut/api-types'
import type { AuthPermissions } from './types/frontend-shapes'
import { AppAxios } from '@/utils/axios'

const Auth = {
  SIGNOUT: '/auth/signout',
  REFRESH_TOKEN: '/auth/refresh',
  PERMISSION: '/auth/permissions',
  KEYS: '/auth/keys',
} as const

/**
 * @description Sign out
 */
export function signoutAPI() {
  return AppAxios.post({
    url: Auth.SIGNOUT,
  })
}

/**
 * @description Refresh accessToken use refreshToken
 */
export function refreshTokenAPI() {
  return AppAxios.post<AuthTokenPayload>({
    url: Auth.REFRESH_TOKEN,
  })
}

/**
 * @description Signin user permissions api
 */
export function getPermissionsAPI() {
  return AppAxios.get<AuthPermissions>({
    url: Auth.PERMISSION,
  })
}

/**
 * @description get baidu ak from backend
 */
export function getBaiduKeyAPI() {
  return AppAxios.get<AuthSecretKeys>(
    {
      url: Auth.KEYS,
      _autoDecryptResponseData: ['B'],
      _cache: true,
    },
  )
}
