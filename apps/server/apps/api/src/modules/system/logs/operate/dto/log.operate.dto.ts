import { ApiProperty } from '@nestjs/swagger'
import { IWalnutAdminConstAppHTTPMethods, WalnutAdminConstAppHTTPMethods } from '@walnut-server/const/app/methods'
import { IWalnutAdminConstDecoratorLogOperateAction, IWalnutAdminConstDecoratorLogOperateType, WalnutAdminConstDecoratorLogOperateAction, WalnutAdminConstDecoratorLogOperateType } from '@walnut-server/const/decorator/logOperate'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldObject,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@walnut-server/list'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import { Recordable } from 'easy-fns-ts'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/log.operate.schema.ts 的 SysLogOperateModel
// 改名 SysLogOperateDTOBase），装饰器与字段本体零改动
export class SysLogOperateDTOBase extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operate title, developer customise',
    },
  })
  title: string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstDecoratorLogOperateAction, {
    swaggerOptions: {
      title: 'operate action type',
    },
  })
  actionType: IWalnutAdminConstDecoratorLogOperateAction

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstDecoratorLogOperateType, {
    swaggerOptions: {
      title: 'operate type',
    },
  })
  operation: IWalnutAdminConstDecoratorLogOperateType

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'http method, like get/post',
    },
    validateOptions: {
      onlyIn: [...Object.values(WalnutAdminConstAppHTTPMethods)],
    },
  })
  method: IWalnutAdminConstAppHTTPMethods

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'http url',
    },
    validateOptions: {
      url: true,
    },
  })
  url: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'http version, like 1.1/2.0',
    },
  })
  httpVersion: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operate location, address string',
    },
  })
  location: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operate operating system',
    },
  })
  os: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operate browser',
    },
  })
  browser: string

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'http status code',
    },
  })
  statusCode: number

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'requset data, stringified',
    },
  })
  // B8 迁 PG（phase2 4.16 / Q7 定案）：列收 jsonb，应用新增直写对象（不再 stringify）；
  // parse 失败原文落同表 raw_request_data text 旁路列。基座仅作 DTO 元数据保留，
  // TS 注解随列型放开为对象（@Prop 不再有运行时语义）；列可空，注解带 null
  requestData: Recordable | null

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'response data, stringified',
    },
  })
  // B8 迁 PG：同 requestData（jsonb 列 + raw_response_data 旁路）
  responseData: Recordable | null

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'responsed milliseconds',
    },
  })
  durationMs: number

  @Expose()
  // B8 迁 PG（phase2 4.16）：user_id 松引用收 uuid，列可空 —— uuid 校验在 DTO 子类
  // 重声明接管（下方模板），TS 注解随列型放开带 null；本基座的 Mongo 装饰器仅作为
  // DTO 元数据保留（模型注册已随迁移从 log.operate.module 摘除，@Prop 不再有运行时语义）
  userId: string | null

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operater user name',
    },
  })
  userName: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { title: 'operate device id' },
  })
  deviceId: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operate ip',
    },
  })
  ip: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operate invoked service and method',
    },
  })
  invokingMethod: string

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'operate success or not',
    },
  })
  success: boolean

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'operatedAt, also known as createdAt',
      required: false,
    },
  })
  @IsOptional({})
  @Expose({})
  operatedAt?: Date

  @WalnutAdminDecoratorFieldObject(Object, {
    swaggerOptions: {
      description: 'snapshot before, mask sensitive object',
    },
    validateOptions: {
      any: true,
    },
    transformOptions: {
      res: {
        maskSensitive: true,
      },
    },
  })
  snapshotBefore: Recordable

  @WalnutAdminDecoratorFieldObject(Object, {
    swaggerOptions: {
      description: 'snapshot after, mask sensitive object',
    },
    validateOptions: {
      any: true,
    },
    transformOptions: {
      res: {
        maskSensitive: true,
      },
    },
  })
  snapshotAfter: Recordable
}

export class SysLogOperateDTO extends SysLogOperateDTOBase {
  constructor(partial: Partial<SysLogOperateDTO>) {
    super()
    Object.assign(this, partial)
  }

  // B1 模板：PG 主键 id（uuid，phase2 4.16）—— @Expose 供响应序列化
  // （ClassSerializerInterceptor excludeExtraneousValues 只放行 Expose 字段）与
  // RealPickType/RealPartialType 的键枚举；入参不从这里进（主键只走路由参数的
  // uuid pipe），IsOptional 仅为 list 查询可选过滤
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string

  // B1 模板（IsMongoId → IsUUID）：子类重声明同名字段，class-validator 按
  // propertyName+type 去重、子类约束整体替换继承的 IsMongoId；松引用列可空
  // （phase2 4.16 user_id NULL YES），nullable 与列型对齐
  @Expose()
  @ApiProperty({
    type: String,
    default: null,
    example: '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c',
  })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  declare userId: string | null
}

// Safe 层曾是「剔除 Mongo `_id`」的派生（B1 模板）；_id 已随 PG 迁移退役后仅存名，
// 快照列仍需对响应侧剔除
export class SysLogOperateDTOSafe extends RealOmitType(
  SysLogOperateDTO,
  ['snapshotBefore', 'snapshotAfter'] as const,
) {
  constructor(partial?: Partial<SysLogOperateDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

class SysLogOperateDTOSafeRequest extends RealPartialType(RealOmitType(SysLogOperateDTOSafe, ['actionType', 'operation', 'operatedAt', 'method'] as const)) {
  @WalnutAdminDecoratorFieldString({
    isArray: true,
    swaggerOptions: {
      title: 'actionType for request query, support array',
    },
    validateOptions: {
      onlyIn: [...Object.values(WalnutAdminConstDecoratorLogOperateAction)],
    },
  })
  @IsOptional({ each: true })
  actionType: IWalnutAdminConstDecoratorLogOperateAction

  @WalnutAdminDecoratorFieldString({
    isArray: true,
    swaggerOptions: {
      title: 'operation for request query, support array',
    },
    validateOptions: {
      onlyIn: [...Object.values(WalnutAdminConstDecoratorLogOperateType)],
    },
  })
  @IsOptional({ each: true })
  operation: IWalnutAdminConstDecoratorLogOperateType

  @WalnutAdminDecoratorFieldDate({
    isArray: true,
    swaggerOptions: {
      title: 'operatedAt for request query, support array',
      required: false,
    },
  })
  @IsOptional({ each: true })
  operatedAt: Date

  @WalnutAdminDecoratorFieldString({
    isArray: true,
    swaggerOptions: {
      title: 'http method for request query, support array',
    },
    validateOptions: {
      onlyIn: [...Object.values(WalnutAdminConstAppHTTPMethods)],
    },
  })
  @IsOptional({ each: true })
  method: IWalnutAdminConstAppHTTPMethods
}

// list
// L2 sort 白名单：admin 操作日志排 title/actionType/operation/method/userName/
// success/operatedAt（views/system/log/operate 七列 sorter，operatedAt 为
// defaultSortOrder descend，有 idx_log_operate_at DESC）；其余列无索引但 admin 在用
// → 保留，见报告建议补索引。实体只有 operated_at 一个时间列，无 createdAt/updatedAt
export class SysLogOperateDTOListRequest extends CreateWalnutAdminRequestListDTO(SysLogOperateDTOSafeRequest, {
  sortOnlyIn: ['title', 'actionType', 'operation', 'method', 'userName', 'success', 'operatedAt'],
}) { }

export class SysLogOperateDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysLogOperateDTOSafe),
) { }

// read
export class SysLogOperateDTOReadResponse extends SysLogOperateDTOSafe { }

// snapshot
export class SysLogOperateDTOSnapshotResponse extends RealPickType(
  SysLogOperateDTO,
  ['snapshotBefore', 'snapshotAfter'] as const,
) {
  constructor(partial?: Partial<SysLogOperateDTOSnapshotResponse>) {
    super()
    Object.assign(this, partial)
  }
}
