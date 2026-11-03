import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import { AppMonitorUserDTOBase } from '@walnut-server/app-domain'
import { WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
  SharedLocationDTO,
  SharedUserAgentDTO,
} from '@walnut-server/list'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { WalnutAdminVirtualDeviceDTO } from '@/common/model/virtual/device'
import { WalnutAdminVirtualUserDTO } from '@/common/model/virtual/user'
import { SysUserDTOSafe } from '@/modules/system/user/dto/user.dto'

/**
 * monitor 用户的 wire 响应面（libs 解耦批 9）。
 *
 * 字段基座 `AppMonitorUserDTOBase` 随监控用户域下沉 `@walnut-server/app-domain`
 * （service / repo / entity 都在 lib）；本文件只保留 wire 组合 ——
 * `WalnutAdminVirtualUserDTO` / `WalnutAdminVirtualDeviceDTO` 引 app 的
 * `SysUserDTOSafe`，swagger schema 注册顺序留 app，所以响应面不能进 lib。
 */

// Virutal

export class AppMonitorUserDTO extends IntersectionType(AppMonitorUserDTOBase, WalnutAdminVirtualUserDTO, WalnutAdminVirtualDeviceDTO) {
  constructor(partial: Partial<AppMonitorUserDTO>) {
    super()
    Object.assign(this, partial)
  }

  // PG 主键 id（uuid，phase2 4.21）：B1 模板 —— @Expose 供响应序列化与
  // RealPickType/RealPartialType 的键枚举；入参不从这里进（主键只走路由参数的
  // uuid pipe）。
  // 批 6-A（F-38 收尾）：响应面 id 是 PG 必填主键，声明去 `?` 与 `@IsOptional()` ——
  // list 查询里的「可选过滤」由 RealPartialType 统一补的 IsOptional 承担（可选性只有
  // 一个真源）；swagger 侧仍 required: false + default: null，文档面零变化。
  @Expose()
  @ApiProperty({ type: String, required: false, default: null })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id: string

  // IsMongoId → IsUUID 模板（B1 确立）：PG 侧 user_id 是可空 uuid 松引用（phase2 4.21），
  // 子类重声明整体替换继承的 IsMongoId 约束。
  // P3-15：未登录访客行 user_id 为 NULL（wire 上 userId: null），swagger 必须同步
  // optional + nullable —— 此前只写 default: null，生成类型是必填 string，与事实不符。
  @Expose()
  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    example: '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c',
  })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  declare userId: string | null
}

// ─── 请求面专有的指纹字段（P0-2）──────────────────────────────────────────────

/**
 * `visitorId` = 客户端自报的**原始浏览器指纹**，**只存在于请求面**。
 *
 * P0-2 之前它是 `AppMonitorUserDTOBase` 的字段 ⇒ 随 list / read 的出参一并回显；而
 * `deviceId = HMAC(指纹, 服务端 key)`（实测 MATCH）⇒ 「读到别人指纹 → 匿名
 * POST /system/device/initial 铸出该设备的合法 cookie」= 一条可复现的账号接管链
 * （订阅对方 OAuth 结果流，review §8.4）。
 *
 * 现在它从基座摘出、只在两个**入参** DTO 上显式声明：
 * - list 的查询过滤（按指纹定位在线行，值不回显）；
 * - 心跳 `POST /app/monitor/user/state` 的 body（批次 8 / B6 起**只作校验**：行键是
 *   服务端从 Cookie 解析的 deviceId，body 的 visitorId 与已存行不一致即 40099）。
 *
 * 响应面（`AppMonitorUserDTOListResponse` / `AppMonitorUserDTOReadResponse`）
 * 不含该字段 —— 定位设备请用 `device.deviceId` / `device.deviceName`。
 */
class AppMonitorUserDTOVisitorIdRequestPayload {
  @WalnutAdminDecoratorFieldString({
    // 字符串校验器恒带 IsString + IsNotEmpty（没有 required 开关）：心跳 body 里它是
    // **行键**，带上才有意义；list 的查询过滤挂在这个类上也不受影响 —— query 信封的
    // 字段级校验器本来就不跑（见下方 AppMonitorUserDTORequest 的 ip 注释）。
    swaggerOptions: {
      title: 'raw browser fingerprint (request side only — never echoed back in responses)',
    },
  })
  @Expose()
  visitorId: string
}

// update state
//
// F-47（2026-11，安全纵深）：白名单里**保留 userId 是为了 wire 契约不变**，但它的
// 取值不再来自请求体 —— controller（user.controller.ts 的 resolveVerifiedUserId）
// 只采信「验签通过的 AT」里的 userId，请求体的该字段会被覆盖成 null（匿名心跳）。
// 也就是说：本字段在入参上存在 ≠ 客户端可以指定它。不要把它当成可写字段用。
//
// 批次 8 / B6（行键归属）：`deviceId` **从入参白名单摘除** —— 行键是服务端从签名
// Cookie（DEVICE_ID）解析出来的设备身份，客户端没有任何合法理由声明它。摘除后
// 全局 ValidationPipe（whitelist + forbidNonWhitelisted）会把请求体里的 deviceId
// 直接判成 40099，而不是像改造前那样「先写进 payload 再被 cookie 值覆盖」——
// 后者在 service 里由 `{ deviceId, ...updatePayload }` 展开顺序决定胜负，纯属运气。
//
// P0-2：`visitorId` 已移出基座，这里用请求面专用的 payload 交叉并入（响应面不受影响）。
// 批次 8 / B6 起它的语义收窄为**校验字段**：与「本设备那一行已存的 visitorId」不一致
// ⇒ 40099 拒绝（见 AppMonitorUserService.updateState）。
export class AppMonitorUserDTOUpdateState extends IntersectionType(
  RealPickType(RealPartialType(AppMonitorUserDTO), ['userId', 'auth', 'focus', 'left', 'currentRouter'] as const),
  AppMonitorUserDTOVisitorIdRequestPayload,
) { }

class AppMonitorUserDTORequest extends IntersectionType(
  RealPartialType(AppMonitorUserDTO),
  // P0-2：指纹过滤是**入参**（按指纹定位在线行），响应不回显指纹本身
  AppMonitorUserDTOVisitorIdRequestPayload,
  RealPartialType(RealPickType(SharedLocationDTO, ['country'] as const)),
  RealPartialType(RealPickType(SharedUserAgentDTO, ['os', 'browser'] as const)),
  RealPartialType(RealPickType(SysUserDTOSafe, ['userName'] as const)),
) {
  // 批 6-A：`ip` 是 list 查询的**可选过滤**字段（不是响应字段）。原先靠
  // `@IsOptional()` 表达可选性 —— 与「DTO 不写 ?/!、可选性归装饰器」的硬规矩相冲，
  // 且 string 校验器没有 nullable 选项可替代。按 5B 的「query 信封不挂 ValidateNested」
  // 先例（list.dto.ts 的 `validateOptions: { required: false }` → Allow），query 的
  // 字段级校验器本来就不会跑，缺省由信封的 `default: {}` 承担，故直接摘掉 IsOptional。
  // swagger 故意不动（不加 required: false）—— 文档面的可选性收敛留给统一导出那一批，
  // 本批只清类型标记，openapi.json 保持零 diff。
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'ip address',
    },
  })
  @Expose()
  ip: string
}

// list
// L2 sort 白名单：monitor 实体没有 createdAt/updatedAt（first_visit_at / last_active_at
// 才是创建/更新列），排除基座同名假列；firstVisitAt 有 api-spec 断言（monitor-user
// api-spec firstVisitAt ascend），lastActiveAt 是 admin 列表默认排序
// （views/app/monitor/user defaultSortOrder descend；无索引 → 见报告建议补索引）
export class AppMonitorUserDTOListRequest extends CreateWalnutAdminRequestListDTO(AppMonitorUserDTORequest, { sortOnlyIn: ['firstVisitAt', 'lastActiveAt'] }) { }

export class AppMonitorUserDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(AppMonitorUserDTO),
) { }

// read
export class AppMonitorUserDTOReadResponse extends AppMonitorUserDTO {}
