/**
 * 响应载荷的**不可推导**形状（OpenAPI codegen 二期收口）。
 *
 * 凡能从 `@walnut/api-types` 生成 operations/schema 推导的响应类型，已全部改用生成别名
 * （AuthTokenPayload / MeSecurityTab1Status / SystemUserLockStatus / SystemDictTypeWithDictData /
 * SystemLogOperateSnapshot / SystemUserDeviceListItem / SystemMenuTreeResponse 等），不再在本文件镜像。
 * 这里保留的只剩三类：
 * 1. server 端 openapi 未声明响应 schema 的端点（monitor/server、deps、key/current、ali/sts、
 *    sign/aes-key、lang public、device initial、identity security-tab2）；
 * 2. 生成类型过松（`{ [key: string]: unknown }`）无法直接喂消费方的窄化形态（WebAuthn options）；
 * 3. 前端变换层形态（Auth.Permissions 的 TreeNodeItem/RouteRecordRaw/IStoreApp 视图形状、
 *    SettingPublic/Private 的 store 形状、User.Preference —— 生成侧 fontSize 为 never，见 DESIGN-ISSUES）。
 */
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import type { SystemLang, SystemMenu } from '@walnut/api-types'
import type { Recordable, TreeNodeItem } from 'easy-fns-ts'
import type { RouteRecordRaw } from 'vue-router'
import type { IStoreApp, IStoreSetting, IStoreUser } from '@/store/types'

export namespace IResponseData {
  export interface BackendDeps {
    dependencies: Recordable
    devDependencies: Recordable
  }

  export namespace Me {
    export namespace Security {
      /**
       * `GET /system/user/me/security-tab2` 响应。server 装饰为 `DTO: null`（swagger 里 data 是
       * null，实际返回本形状）且带 `// TODO should remove` —— 无法推导，保留手写；已登记 DESIGN-ISSUES。
       */
      export interface Tab2Status {
        totp: {
          status: boolean
          verified: boolean
        }
        webauthn: {
          status: boolean
          verified: boolean
        }
      }

      export interface Tab3Status {

      }
    }
  }

  export namespace App {
    export namespace Monitor {
      /** 以下 server 端点（/app/monitor/server/*）无 swagger schema（systeminformation 直出） */
      export interface CPU {
        cores: number
        brand: string
        speed: number
        manufacturer: string
      }

      export interface Mem {
        total: number
        free: number
        used: number
        avaiable: number
      }

      export interface OS {
        hostname: string
        arch: string
        platform: string
        distro: string
      }

      export interface System {
        manufacturer: string
        model: string
        version: string
        uuid: string
      }

      export interface Disk {
        name: string
        size: number
        device: string
        type: string
      }

      export interface Battery {
        voltage: number
        designedCapacity: number
        currentCapacity: number
        percent: number
      }

      export interface Time {
        current: number
        uptime: number
        timezone: string
        timezoneName: string
      }

      export interface Network {
        iface: string
        ip4: string
        mac: string
        netSpeed: string
      }
    }

    export namespace Key {
      /** `/app/key/current/{type}` 无 swagger schema */
      export interface Current {
        keyB64: string
      }
    }

    /**
     * `/app/setting/public`。生成 AppSettingDTOPublicResponse 全字段必填，而前端按 Partial 消费
     * （store 状态逐项 hydrate），沿用 store 侧形状。
     */
    export type SettingPublic = IStoreApp.SettingBackend

    /** `/app/setting/private`（IStoreSetting.Scope），同上属前端消费形态 */
    export type SettingPrivate = IStoreSetting.Scope
  }

  export namespace Auth {
    export namespace MFA {
      export namespace Webauthn {
        /**
         * 生成的 SysUserMfaWebauthnRegisterResponseDTO.options 是 `{ [key: string]: unknown }`，
         * 喂不进 @simplewebauthn/browser 的 startRegistration —— 这里按 WebAuthn 规范收窄，
         * 属消费侧形状（wire 真源仍是生成类型）。
         */
        export interface RegisterOptions {
          options: PublicKeyCredentialCreationOptionsJSON
        }

        export interface AuthenticateOptions {
          options: PublicKeyCredentialRequestOptionsJSON
        }
      }

    }

    /**
     * `GET /auth/permissions` 响应。wire 真源是生成的 AuthCorePermissionsDTO，但前端消费需要
     * 变换层形状（TreeNodeItem/RouteRecordRaw/IStoreApp.Tab.Item —— server 下发的 component 是
     * string，喂不进 buildRoutes 的 RouteRecordRaw 联合类型），故保留本接口、成员改引生成别名。
     */
    export interface Permissions {
      permissionMenuTree: TreeNodeItem<SystemMenu>[]
      permissionRouteTree: RouteRecordRaw[]
      permissionStrings: string[]
      keepAliveNames: string[]
      indexMenuName: string
      affixedTabs: IStoreApp.Tab.Item[]
      internalIframeList: { name: string, url: string, cache: boolean }[]
    }

    /** `/auth/keys`（百度 ak，解密后单字段），无 swagger schema */
    export interface Keys {
      B: string
    }
  }

  export namespace Security {
    export namespace Sign {
      /** `/security/sign/aes-key` 无 swagger schema */
      export interface AesKey {
        aesKey?: string
        hkdfInfo: string
      }
    }
  }

  export namespace Shared {
    export interface AliStsToken {
      accessKeyId: string
      accessKeySecret: string
      stsToken: string
      region: string
      bucket: string
    }
  }

  export namespace System {
    export namespace Device {
      /** `POST /system/device/initial` 无 swagger 响应 schema（server 回显注册后设备形态） */
      export interface Initial {
        deviceId: string
        longitude?: number
        latitude?: number
        countryCode?: string
      }
    }

    export namespace Lang {
      /** `/system/lang/list/public` 无 swagger 响应 schema，保留手写（字段对齐生成 SystemLang） */
      export type Public = Pick<SystemLang, 'lang' | 'description' | 'order'>[]
    }

    export namespace User {
      /**
       * 用户偏好。生成 SysUserPreferenceResponseDTO 的 fontSize 为 never（server 枚举装饰缺陷，
       * 见 DESIGN-ISSUES），推导不了，保留 store 形状。
       */
      export type Preference = IStoreUser.Preference.State
    }
  }
}
