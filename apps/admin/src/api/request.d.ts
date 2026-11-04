import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/browser'
import type { components, SystemDeleted, SystemUser, SystemUserIdentityPurpose, SystemUserIdentityType } from '@walnut/api-types'

export namespace IRequestPayload {
  export namespace App {}

  export namespace Auth {

    export namespace MFA {
      export namespace Totp {

        export interface Generate {
          name: string
        }

        export interface Bind {
          name: string
          code: string
          tempTotpId: string
        }

        export interface Verify {
          trusted: boolean
          code: string
        }
      }

      export namespace Webauthn {
        export interface RegisterOptions {
          name: string
        }

        export interface RegisterVerify {
          name: string
          response: RegistrationResponseJSON
        }

        export interface AuthenticateVerify {
          trusted: boolean
          response: AuthenticationResponseJSON
        }
      }
    }
    export interface KickOutAllDevices {
      type: string
    }

    export interface KickOutAllDevicesForAdmin extends KickOutAllDevices {
      // 目标用户主键（PG uuid，对齐 Safe DTO 的 id 契约）
      id: string
    }

    export namespace OTP {

      interface Base {
        type: 'sms' | 'email'
      }
      export interface Send extends Base {
        identifier: string
      }

      export interface Verify extends Send {
        verifyCode: number
      }
    }

    export interface Password {
      userName: string
      password: string
      rememberMe?: boolean
    }

    export interface Google {
      credential: string
      select_by: string
    }

    export namespace Opaque {

      export namespace Admin {
        // 管理端按 user 主键（uuid）定位，对齐 server AuthOpaqueAdminUserIdDTO（B7a）
        export interface UpdatePasswordStart extends Opaque.Register.Start {
          id: string
        }

        export interface UpdatePasswordFinish extends Opaque.Register.Finish {
          id: string
        }

        export interface ResetPasswordStart extends Opaque.Register.Start {
          id: string
        }

        export interface ResetPasswordFinish extends Opaque.Register.Finish {
          id: string
        }
      }
      export namespace Login {
        export interface Start extends Pick<SystemUser, 'userName'>, Opaque.Register.Start {}

        export interface Finish extends Pick<SystemUser, 'userName'>, Opaque.Register.Finish {}

        export interface ClientError extends Pick<SystemUser, 'userName'> {
          clientError: 'passwordError' | 'serverStaticKeyMismatch'
        }
      }

      export namespace Register {
        export interface Start {
          start: string
        }

        export interface Finish {
          finish: string
        }
      }
    }
  }

  export namespace Security {}

  export namespace Shared {}

  export namespace System {

    export namespace UserIdentity {
      export interface Status {
        type: SystemUserIdentityType
        purpose: SystemUserIdentityPurpose
        status: boolean
      }
      export interface Verify {
        type: SystemUserIdentityType
        purpose: SystemUserIdentityPurpose
        verifyCode: string
      }
      export interface Check {
        type: SystemUserIdentityType
        purpose: SystemUserIdentityPurpose
        identifier: string
      }

      export interface Bind {
        type: SystemUserIdentityType
        purpose: SystemUserIdentityPurpose
        identifier: string
        verifyCode: string
        setAsSecurity: boolean
      }
    }
    export namespace Deleted {
      // B9 起 sys_deleted 迁 PG：主键响应契约 `_id` → `id`（uuid）
      export type Recover = Pick<SystemDeleted, 'id' | 'deletedId'>
    }

    export namespace Deivce {
      /**
       * `POST /system/device/initial` 的请求体 —— wire 真源是 server 的 `SysDeviceDTOInitialRequest`
       * （apps/server/libs/system/src/device/dto/device.dto.ts:211 =
       * `RealPickType(SysDeviceDTOSafe, ['sr', 'vp', 'hardwareInfo', 'deviceInfo', 'private'])`），
       * 生成形态见 packages/generated/api-types/src/schema.d.ts:5253。
       *
       * 为什么不再用 `Omit<SystemDevice, 'id' | 'deviceName'>`：SystemDevice 是**实体 / 响应**面，
       * 会凭空要求 deviceId / ip / locationInfo / locationHistory … 这些只有服务端才填的键，
       * 请求面永远差一截 —— 旧的 `as` 正是靠断言把这层差异盖住的。请求面与实体面在这里分开。
       *
       * `deviceName` 不在这份契约里（B5 起服务端生成，device.service.ts:94-96）：多带一个就是
       * excess property，调用点写 `satisfies` 会直接红 —— 这就是 P4 要的机械守卫
       * （此前 `as` 会吞掉它：多带 deviceName 时 tsc 零报错，只能靠服务端 40099 兜住）。
       *
       * 请求面就是生成物本身，不再有 shim：这里曾额外摊平 `deviceInfo` 只为把 `type` 掰回可选 ——
       * openapi.json 的 `SharedUserAgentDTOPartial` 没有 required 数组（class-validator 侧
       * `RealPartialType` 给每个字段挂的是 `IsOptional`），是 openapi-typescript 的
       * defaultNonNullable 把带 `default: 'bot'` 的字段抬成了必填。`pnpm generate` 已加
       * `--default-non-nullable=false`，失真消失，shim 删除；现在生成物的可选性与
       * openapi.json 一一对应，调用点不必再靠断言遮掩。
       */
      export type Initial = components['schemas']['SysDeviceDTOInitialRequest']
    }

    export namespace UserDevice {
      export interface UpdateName {
        deviceId: string
        deviceName: string
      }

      export interface ForceQuit {
        deviceId: string
      }

      export interface Lock {
        deviceId: string
      }

      export interface Unlock {
        deviceId: string
        lockPwdHash?: string
      }

    }
  }
}
