import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { SharedLocationDTO, SharedUserAgentDTO } from '@/common/dto/shared.dto'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { WalnutAdminVirtualDeviceDTO } from '@/common/model/virtual/device'
import { WalnutAdminVirtualUserDTO } from '@/common/model/virtual/user'
import { SysUserDTOSafe } from '@/modules/system/user/dto/user.dto'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/user.schema.ts 的 AppMonitorUserModel
// 改名 AppMonitorUserDTOBase），装饰器与字段本体零改动
//
// B6 起本基座不再注册进 Mongoose（模型注册随迁移摘除），仅作为 DTO 链的
// 校验/swagger 元数据基座保留；@Prop / virtual 不再有运行时语义。
// userId 的 uuid 校验在 DTO 子类重声明（同 B1 模板）；deviceId 保持字符串业务键。
export class AppMonitorUserDTOBase extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'fingerprint for auth and no auth users',
    },
  })
  visitorId: string

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

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'createdAt, used as `firstVisitAt`',
      required: false,
    },
  })
  @IsOptional({})
  firstVisitAt: Date

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'updatedAt, used as `lastActiveAt`',
      required: false,
    },
  })
  @IsOptional({})
  lastActiveAt: Date
}

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
