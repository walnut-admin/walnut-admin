import { WalnutAdminDecoratorFieldBoolean, WalnutAdminDecoratorFieldDate, WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { WalnutAdminCommonBasicModel } from '@walnut-server/identity'
import { Expose } from 'class-transformer'

/**
 * app_monitor_user 的字段基座（libs 解耦批 9 随监控用户域下沉）。
 *
 * wire 侧的 `AppMonitorUserDTO` 需要 `WalnutAdminVirtualUserDTO` /
 * `WalnutAdminVirtualDeviceDTO`（二者引 app 的 `SysUserDTOSafe`，swagger schema
 * 注册顺序留 app），因此本基座单独放 lib 给 `AppMonitorUserService` / drift spec
 * 使用；app 的 `dto/user.dto.ts` 从这里 import 基座再组合 wire 响应面。
 *
 * 批 4 结构重构：schema/ 并入 dto/（原 schema/user.schema.ts 的 AppMonitorUserModel
 * 改名 AppMonitorUserDTOBase），装饰器与字段本体零改动。
 *
 * B6 起本基座不再注册进 Mongoose（模型注册随迁移摘除），仅作为 DTO 链的
 * 校验/swagger 元数据基座保留；@Prop / virtual 不再有运行时语义。
 * userId 的 uuid 校验在 DTO 子类重声明（同 B1 模板）；deviceId 保持字符串业务键。
 */
export class AppMonitorUserDTOBase extends WalnutAdminCommonBasicModel {
  // P0-2（设备追踪 P0 批）：`visitorId`（= **原始浏览器指纹**）从本基座摘除 ——
  // 基座是「请求 + 响应」共用的字段面，留着它等于让每个派生响应都回显指纹。
  // 而**当时**的 deviceId = HMAC(指纹, 服务端 key)：指纹一旦下发，「拿到指纹 → 铸出该设备的
  // 合法 cookie → 订阅它的 OAuth 结果流」就是一条可复现的账号接管链（review §8.4）。
  // （B5 起该等式已不成立 —— device_id 由服务端随机签发、指纹不再派生身份，判据见
  //  libs/const/src/app/device.ts；但「为什么把 visitorId 从响应面摘掉」与它无关，结论仍成立。）
  // 现在该字段只存在于**请求面**：`AppMonitorUserDTOUpdateState`（心跳的**校验字段**，
  // 批次 8 / B6 起不再是行键 —— 行键是服务端从 Cookie 解析的 deviceId）与 list 的查询
  // 过滤，两者在 app 的 wire DTO 里显式声明。响应面（list / read）
  // 不再有任何指纹字段 —— 需要定位设备时用 device.deviceId / device.deviceName。
  // 实体列 app_monitor_user.visitor_id 不受影响（服务端内部仍按它记账）。

  // B6：PG 侧 user_id 是可空 uuid 松引用（phase2 4.21）；属性 TS 类型随列型放开为
  // string（uuid 校验在 DTO 子类重声明接管）
  @Expose()
  userId: string | null

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { title: 'device id' },
  })
  deviceId: string

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'auth or not',
    },
  })
  auth: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'focus on current page or not',
    },
  })
  focus: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'left page or not',
    },
  })
  left: boolean

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'current page router',
    },
  })
  currentRouter: string

  // 批 6-A：firstVisitAt / lastActiveAt 是响应面字段，映射自实体 created_at /
  // last_active_at（DB 必有值），故去掉 `@IsOptional({})` —— 可选性不再由
  // 「类型」与「校验器」各说一次（原先是类型必填 + 校验器可选的自相矛盾形态）。
  // swagger 的 required: false 保留：字段名在 wire 上与基座 createdAt/updatedAt 不同，
  // 文档面不作为「必填时间列」承诺，openapi.json 零 diff。
  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'createdAt, used as `firstVisitAt`',
      required: false,
    },
  })
  firstVisitAt: Date

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'updatedAt, used as `lastActiveAt`',
      required: false,
    },
  })
  lastActiveAt: Date
}
