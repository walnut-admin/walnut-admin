import { Body, Controller } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { WalnutAdminDecoratorParamMongoId } from '@walnut-server/decorators/params'
import { WalnutCrudDecorators } from '@/decorators/crud'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'

import {
  SysRoleDTOCreateRequest,
  SysRoleDTOCreateResponse,
  SysRoleDTOListRequest,
  SysRoleDTOListResponse,
  SysRoleDTOReadResponse,
  SysRoleDTOSafe,
  SysRoleDTOUpdateRequest,
  SysRoleDTOUpdateResponse,
} from './dto/role.dto'

import { SysRoleService } from './role.service'

const Permissions = {
  CREATE: 'system:role:create',
  READ: 'system:role:read',
  UPDATE: 'system:role:update',
  LIST: 'system:role:list',
} as const

const { WalnutAdminDecoratorCreate, WalnutAdminDecoratorRead, WalnutAdminDecoratorUpdate, WalnutAdminDecoratorList }
  = WalnutCrudDecorators({
    title: WalnutAdminConstDecoratorLogOperateTitle.ROLE,
    DTO: SysRoleDTOSafe,
  })

@Controller('system/role')
@ApiTags('system/role')
export class SysRoleController {
  constructor(private readonly roleService: SysRoleService) {}

  @WalnutAdminDecoratorHasPermission(Permissions.CREATE)
  @WalnutAdminDecoratorCreate()
  async create(@Body() payload: SysRoleDTOCreateRequest) {
    return new SysRoleDTOCreateResponse(
      (await this.roleService.create(payload)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamMongoId() id: string) {
    return new SysRoleDTOReadResponse(
      (await this.roleService.read(id)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE)
  @WalnutAdminDecoratorUpdate()
  async update(
    @WalnutAdminDecoratorParamMongoId() id: string,
    @Body() payload: SysRoleDTOUpdateRequest,
  ) {
    return new SysRoleDTOUpdateResponse(
      (await this.roleService.update(id, payload)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysRoleDTOListRequest) {
    return new SysRoleDTOListResponse(await this.roleService.list(payload))
  }
}
