import type { MeSecurityTab2Status, SystemUser } from '@walnut/api-types'
import { SystemEndpointRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

/**
 * @description switch role
 */
export function switchRoleAPI(roleId: string) {
  return AppAxios.patch<boolean>({
    url: `${SystemEndpointRoutes.USER_ME_SWITCH_ROLE}/${roleId}`,
  })
}

/**
 * @description Signin user detail info api
 */
export function getUserProfileAPI() {
  return AppAxios.get<SystemUser>({
    url: SystemEndpointRoutes.USER_ME_PROFILE,
  })
}

/**
 * @description update profile
 * 载荷不含主键（me/profile 按 token 定位当前用户），对齐 server SysUserMeDTOUpdateProfileRequest
 */
export function updateProfileAPI(data: Partial<SystemUser>) {
  return AppAxios.put<boolean>({
    url: SystemEndpointRoutes.USER_ME_PROFILE,
    data,
  })
}

/**
 * @description get user center security tab 2 status
 */
export function getSecurityTab2StatusAPI() {
  return AppAxios.get<MeSecurityTab2Status>({
    url: SystemEndpointRoutes.USER_ME_SECURITY_TAB2,
  })
}
