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
import { IsOptional } from 'class-validator'
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
  // uuid pipe），IsOptional 仅为 list 查询可选过滤
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string

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
export class AppMonitorUserDTOUpdateState extends RealPickType(RealPartialType(AppMonitorUserDTO), ['visitorId', 'deviceId', 'userId', 'auth', 'focus', 'left', 'currentRouter'] as const) { }

class AppMonitorUserDTORequest extends IntersectionType(
  RealPartialType(AppMonitorUserDTO),
  RealPartialType(RealPickType(SharedLocationDTO, ['country'] as const)),
  RealPartialType(RealPickType(SharedUserAgentDTO, ['os', 'browser'] as const)),
  RealPartialType(RealPickType(SysUserDTOSafe, ['userName'] as const)),
) {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'ip address',
    },
  })
  @IsOptional()
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
