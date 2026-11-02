import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import {
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { WalnutAdminCommonBasicModel } from '@walnut-server/identity'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@walnut-server/list'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { ISysEmployeeStatus, SysEmployeeStatusConst } from '../employee.const'

/**
 * 职工 DTO 基座 ↔ `SysEmployeeEntity` 逐字段对应。
 *
 * `userId` 是**唯一可空松引用**（无 FK）：读写走本模块的 bind/unbind 端点或 update，
 * 「一号一职工」由 partial unique（uq_employee_user）兜底 + 服务层前置查重受控。
 */
export class SysEmployeeDTOBase extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'employee no',
      description: 'unique business key, the payroll number',
    },
    validateOptions: { maxLen: 64 },
  })
  employeeNo: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'employee name',
    },
  })
  employeeName: string

  // FK → sys_dept(id) RESTRICT：有职工的部门不许删
  @WalnutAdminDecoratorFieldString({
    // 数据权限批 4 / B1：关掉入参 booleanString Transform —— 否则未提交/显式 null
    // 都会被物化成自有属性，无法区分「未给」与「显式清空」（见 user.dto 同字段注释）
    transformOptions: { req: { booleanString: false } },
    swaggerOptions: {
      title: 'dept id',
      example: '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c',
    },
  })
  @WalnutAdminDecoratorValidatorUuid()
  deptId: string

  // FK → sys_post(id) RESTRICT；未定岗为 null
  @WalnutAdminDecoratorFieldString({
    default: null,
    validateOptions: { nullable: true },
    swaggerOptions: { title: 'post id', nullable: true },
  })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  postId: string | null

  // 松引用 sys_user(id)（不建 FK）；partial unique 保证「一号一职工」
  @WalnutAdminDecoratorFieldString({
    default: null,
    validateOptions: { nullable: true },
    swaggerOptions: { title: 'bound user id', nullable: true },
  })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  userId: string | null

  // 入职时间（timestamptz，与全仓时间列同型；必填）
  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'entry date',
      example: '2026-01-01 00:00:00',
    },
  })
  entryDate: Date

  @WalnutAdminDecoratorFieldEnum(() => SysEmployeeStatusConst, {
    default: SysEmployeeStatusConst.ACTIVE,
    swaggerOptions: {
      title: 'employee status',
      description: 'probation / active / resigned; resigned does NOT delete or unbind the account',
      example: SysEmployeeStatusConst.ACTIVE,
    },
  })
  status: ISysEmployeeStatus
}

export class SysEmployeeDTO extends SysEmployeeDTOBase {
  constructor(partial?: Partial<SysEmployeeDTO>) {
    super()
    Object.assign(this, partial)
  }

  @Expose()
  @ApiProperty({ type: String, required: false, default: null })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id: string
}

export class SysEmployeeDTOSafe extends SysEmployeeDTO {
  constructor(partial?: Partial<SysEmployeeDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysEmployeeDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysEmployeeDTOSafe),
  { sortOnlyIn: ['employeeNo', 'employeeName', 'entryDate', 'status', 'createdAt', 'updatedAt'] },
) {}

export class SysEmployeeDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysEmployeeDTOSafe),
) {}

// create：工号 / 姓名 / 部门 / 入职时间 / 状态必填；岗位可暂缺（先录入再定岗）。
// `userId` **不进出参白名单** —— 账号绑定只走 bind-user / unbind-user 两个动作端点，
// 避免「编辑人事档案时把绑定关系顺手清掉」的隐式副作用（缺省即 null 的整体替换语义
// 在这里不适用）。
export class SysEmployeeDTOCreateRequest extends IntersectionType(
  RealPickType(SysEmployeeDTOSafe, [
    'employeeNo',
    'employeeName',
    'deptId',
    'entryDate',
    'status',
  ] as const),
  RealPartialType(RealPickType(SysEmployeeDTOSafe, ['postId'] as const)),
) {}
export class SysEmployeeDTOCreateResponse extends SysEmployeeDTOSafe {}

export class SysEmployeeDTOReadResponse extends SysEmployeeDTOSafe {}

// update：与 create 同形 —— PUT 是整体替换（postId 缺省即清空 = 未定岗）；
// userId 同样不在写白名单，绑定关系只经 bind/unbind 端点变更。
export class SysEmployeeDTOUpdateRequest extends IntersectionType(
  RealPickType(SysEmployeeDTOSafe, [
    'employeeNo',
    'employeeName',
    'deptId',
    'entryDate',
    'status',
  ] as const),
  RealPartialType(RealPickType(SysEmployeeDTOSafe, ['postId'] as const)),
) {}
export class SysEmployeeDTOUpdateResponse extends SysEmployeeDTOSafe {}

export class SysEmployeeDTODeleteResponse extends SysEmployeeDTOSafe {}

/** bindUser 入参：把职工绑定到某个登录账号（一号一职工由服务层查重 + uq 约束兜底） */
export class SysEmployeeDTOBindUserRequest {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'user id',
      description: 'sys_user primary key (uuid)',
      example: '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c',
    },
  })
  @WalnutAdminDecoratorValidatorUuid()
  userId: string
}
