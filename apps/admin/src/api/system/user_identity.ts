import type { MeSecurityTab1Status, SystemUserIdentityPurpose, SystemUserIdentityType } from '@walnut/api-types'
import type { IRequestPayload } from '../request'
import { SystemEndpointRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

/**
 * @description get user center security tab 1 status
 */
export function getSecurityTab1StatusAPI2(purpose: SystemUserIdentityPurpose) {
  return AppAxios.get<MeSecurityTab1Status>({
    url: `${SystemEndpointRoutes.USER_IDENTITY_STATUS}/${purpose}`,
  })
}

/**
 * @description check user identity
 */
export function checkUserIdentityAPI(data: IRequestPayload.System.UserIdentity.Check) {
  return AppAxios.post<boolean>({
    url: `${SystemEndpointRoutes.USER_IDENTITY_CHECK}/${data.type}/${data.purpose}`,
    data: {
      identifier: data.identifier,
    },
  })
}

/**
 * @description bind user identity
 */
export function bindUserIdentityAPI(data: IRequestPayload.System.UserIdentity.Bind) {
  return AppAxios.post<boolean>({
    url: `${SystemEndpointRoutes.USER_IDENTITY_BIND}/${data.type}/${data.purpose}`,
    data: {
      identifier: data.identifier,
      verifyCode: data.verifyCode,
      setAsSecurity: data.setAsSecurity,
    },
  })
}

/**
 * @description unbind user identity
 */
export function unBindUserIdentityAPI(type: SystemUserIdentityType, purpose: SystemUserIdentityPurpose) {
  return AppAxios.delete<boolean>({
    url: `${SystemEndpointRoutes.USER_IDENTITY_UNBIND}/${type}/${purpose}`,
  })
}

/**
  @description send code with otp
 */
export function sendCodeForVerifyAPI(type: SystemUserIdentityType, purpose: SystemUserIdentityPurpose) {
  return AppAxios.post<boolean>({
    url: `${SystemEndpointRoutes.USER_IDENTITY_SEND_CODE}/${type}/${purpose}`,
  })
}

/**
 * @description update user identity status
 */
export function updateUserIdentityStatusAPI(data: IRequestPayload.System.UserIdentity.Status) {
  return AppAxios.put<boolean>({
    url: `${SystemEndpointRoutes.USER_IDENTITY_STATUS}/${data.type}/${data.purpose}`,
    data: {
      status: data.status,
    },
  })
}

/**
 * @description verify user identity
 */
export function verifyUserIdentityAPI(data: IRequestPayload.System.UserIdentity.Verify) {
  return AppAxios.post<boolean>({
    url: `${SystemEndpointRoutes.USER_IDENTITY_VERIFY}/${data.type}/${data.purpose}`,
    data: {
      verifyCode: data.verifyCode,
    },
  })
}
