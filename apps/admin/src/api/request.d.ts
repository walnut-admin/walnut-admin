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
       */
      export type Initial = Omit<InitialWire, 'deviceInfo'> & { deviceInfo: InitialDeviceInfo }

      /** server `SysDeviceDTOInitialRequest` 的生成形态（openapi.json → schema.d.ts:5253）。 */
      type InitialWire = components['schemas']['SysDeviceDTOInitialRequest']

      /**
       * `deviceInfo` 的请求面形态：值域不动（就是服务端 `IDeviceTypeConst`，见
       * apps/server/libs/list/src/device-geo.dto.ts:13-20 → 生成物 schema.d.ts:3465：
       * desktop / mobile / tablet / bot），只把 `type` 标成可选。
       *
       * 生成物把它当必填属于 codegen 失真：openapi.json 的 `SharedUserAgentDTOPartial` 没有
       * required 数组，是 openapi-typescript 的 defaultNonNullable 把带 `default: 'bot'` 的字段
       * 抬成了非可选；class-validator 侧 `RealPartialType` 给每个字段挂的是 `IsOptional`
       * （apps/server/libs/utils/src/dto.ts:67-85），server 自己的 DTO spec 就用 `deviceInfo: {}`
       * 断言零错误（device.dto.spec.ts:34-45）。
       *
       * 为什么不干脆发一个值：服务端一定用 UA 算出的类型覆盖客户端传的值
       * （device.service.ts:112-113、133-138），而 admin 自己的设备分类
       * （src/const/app.ts:8-13 的 AppConstDevice）多一个 `laptop` —— 不在该枚举里，
       * 发过去只会是一份被丢弃的猜测值。
       */
      type InitialDeviceInfo = Omit<components['schemas']['SharedUserAgentDTOPartial'], 'type'> & {
        type?: components['schemas']['SharedUserAgentDTOPartial']['type']
      }
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
