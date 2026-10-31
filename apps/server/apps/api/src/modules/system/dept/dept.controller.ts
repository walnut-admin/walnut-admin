import { Body, Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common'
import { ApiQuery, ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { WalnutCrudDecorators } from '@walnut-server/crud'

import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { WalnutAdminDecoratorParamUuid } from '@walnut-server/decorators/params'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminExceptionInvalidID } from '@walnut-server/exceptions/base/400'

import { SysDeptDTOCreateRequest, SysDeptDTOCreateResponse, SysDeptDTODeleteResponse, SysDeptDTOListRequest, SysDeptDTOListResponse, SysDeptDTOReadResponse, SysDeptDTOSafe, SysDeptDTOTree, SysDeptDTOUpdateRequest, SysDeptDTOUpdateResponse, SysDeptService } from '@walnut-server/system'
import { plainToInstance } from 'class-transformer'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'

const Permissions = {
  CREATE: 'system:dept:create',
  READ: 'system:dept:read',
  UPDATE: 'system:dept:update',
  DELETE: 'system:dept:delete',
  LIST: 'system:dept:list',
} as const

const {
  WalnutAdminDecoratorCreate,
  WalnutAdminDecoratorRead,
  WalnutAdminDecoratorUpdate,
  WalnutAdminDecoratorDelete,
  WalnutAdminDecoratorList,
} = WalnutCrudDecorators({
  title: WalnutAdminConstDecoratorLogOperateTitle.DEPT,
  DTO: SysDeptDTOSafe,
})

// children 的 parentId 是可选 query（缺省 = 根层）：与路由参数的必填 pipe 不同，
// 这里做「给了就必须是 uuid」的语法级校验，非法值回 40002
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 部门 controller —— 标准 CRUD + 三个只读树端点：
 * - `GET tree`：全量树（children 嵌套，管理页树表格的数据源）；
 * - `GET children?parentId=`：按父查一层（缺省根层；懒加载/级联选择器）；
 * - `GET :id/subtree`：递归 CTE 子树（含深度与 CYCLE 兜底，数据权限的「本部门及以下」取数口）。
 *
 * 路由声明顺序有要求：`tree` / `children` 必须先于 `:id`（Nest 按声明序匹配）。
 */
@Controller('system/dept')
@ApiTags('system/dept')
export class SysDeptController {
  constructor(private readonly deptService: SysDeptService) {}

  @Get('tree')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @ApiWalnutOkResponse({
    description: 'return full dept tree',
    DTO: SysDeptDTOTree,
    isArray: true,
  })
  async tree() {
    return plainToInstance(SysDeptDTOTree, await this.deptService.tree())
  }

  @Get('children')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @ApiQuery({
    name: 'parentId',
    type: String,
    required: false,
    description: 'parent dept id, omitted => root level',
  })
  @ApiWalnutOkResponse({
    description: 'return direct children of one dept',
    DTO: SysDeptDTOSafe,
    isArray: true,
  })
  async children(@Query('parentId') parentId?: string) {
    if (parentId !== undefined && parentId !== '' && !UUID_REGEX.test(parentId)) {
      throw new WalnutAdminExceptionInvalidID()
    }

    const normalized = parentId === undefined || parentId === '' ? null : parentId
    return plainToInstance(SysDeptDTOSafe, await this.deptService.children(normalized))
  }

  @Get(':id/subtree')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @ApiWalnutOkResponse({
    description: 'return the subtree rooted at one dept (recursive CTE)',
    DTO: SysDeptDTOTree,
  })
  async subtree(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(SysDeptDTOTree, await this.deptService.subtree(id))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.CREATE)
  @WalnutAdminDecoratorCreate()
  async create(@Body() payload: SysDeptDTOCreateRequest) {
    return plainToInstance(SysDeptDTOCreateResponse, await this.deptService.create(payload))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(SysDeptDTOReadResponse, await this.deptService.read(id))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE)
  @WalnutAdminDecoratorUpdate()
  async update(
    @Body() payload: SysDeptDTOUpdateRequest,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return plainToInstance(SysDeptDTOUpdateResponse, await this.deptService.update(id, payload))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.DELETE)
  @WalnutAdminDecoratorDelete()
  @WalnutTx()
  async delete(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return plainToInstance(
      SysDeptDTODeleteResponse,
      await this.deptService.delete(id, user.userId, ctx.em),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysDeptDTOListRequest) {
    return plainToInstance(SysDeptDTOListResponse, await this.deptService.list(payload))
  }
}
