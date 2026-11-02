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

// update state
//
// F-47（2026-11，安全纵深）：白名单里**保留 userId 是为了 wire 契约不变**，但它的
// 取值不再来自请求体 —— controller（user.controller.ts 的 resolveVerifiedUserId）
// 只采信「验签通过的 AT」里的 userId，请求体的该字段会被覆盖成 null（匿名心跳）。
// 也就是说：本字段在入参上存在 ≠ 客户端可以指定它。不要把它当成可写字段用。
export class AppMonitorUserDTOUpdateState extends RealPickType(RealPartialType(AppMonitorUserDTO), ['visitorId', 'deviceId', 'userId', 'auth', 'focus', 'left', 'currentRouter'] as const) { }

class AppMonitorUserDTORequest extends IntersectionType(
  RealPartialType(AppMonitorUserDTO),
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
