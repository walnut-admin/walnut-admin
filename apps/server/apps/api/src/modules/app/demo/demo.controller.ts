import { Body, Controller } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { WalnutDBSession, WalnutDBTransaction } from '@walnut-server/db'
import {
  WalnutAdminDecoratorParamMongoId,
  WalnutAdminDecoratorParamMongoIds,
} from '@walnut-server/decorators/params'
import { ClientSession } from 'mongoose'
import { WalnutCrudDecorators } from '@/decorators/crud'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { AppDemoService } from './demo.service'
import {
  AppDemoDTOCreateRequest,
  AppDemoDTOCreateResponse,
  AppDemoDTODeleteResponse,
  AppDemoDTOListRequest,
  AppDemoDTOListResponse,
  AppDemoDTOReadResponse,
  AppDemoDTOSafe,
  AppDemoDTOUpdateRequest,
  AppDemoDTOUpdateResponse,
} from './dto/demo.dto'

const Permissions = {
  CREATE: 'app:demo:create',
  READ: 'app:demo:read',
  UPDATE: 'app:demo:update',
  DELETE: 'app:demo:delete',
  LIST: 'app:demo:list',
} as const

const {
  WalnutAdminDecoratorCreate,
  WalnutAdminDecoratorRead,
  WalnutAdminDecoratorUpdate,
  WalnutAdminDecoratorDelete,
  WalnutAdminDecoratorDeleteMany,
  WalnutAdminDecoratorList,
} = WalnutCrudDecorators({
  title: WalnutAdminConstDecoratorLogOperateTitle.APP_DEMO,
  DTO: AppDemoDTOSafe,
})

@Controller('app/demo')
@ApiTags('app/demo')
export class AppDemoController {
  constructor(private readonly demoService: AppDemoService) { }

  @WalnutAdminDecoratorHasPermission(Permissions.CREATE)
  @WalnutAdminDecoratorCreate()
  async create(@Body() payload: AppDemoDTOCreateRequest) {
    return new AppDemoDTOCreateResponse(
      (await this.demoService.create(payload)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamMongoId() id: string) {
    return new AppDemoDTOReadResponse(
      (await this.demoService.read(id)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE)
  @WalnutAdminDecoratorUpdate()
  async update(
    @WalnutAdminDecoratorParamMongoId() id: string,
    @Body() payload: AppDemoDTOUpdateRequest,
  ) {
    return new AppDemoDTOUpdateResponse(
      (await this.demoService.update(id, payload)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.DELETE)
  @WalnutAdminDecoratorDelete()
  @WalnutDBTransaction()
  async delete(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() session: ClientSession,
    @WalnutAdminDecoratorParamMongoId() id: string,
  ) {
    return new AppDemoDTODeleteResponse(
      (await this.demoService.delete(id, user.userId, session)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.DELETE)
  @WalnutAdminDecoratorDeleteMany()
  @WalnutDBTransaction()
  async deleteMany(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() session: ClientSession,
    @WalnutAdminDecoratorParamMongoIds() ids: string[],
  ) {
    const deleted = await this.demoService.deleteMany(ids, user.userId, session)

    return deleted.map(i => new AppDemoDTODeleteResponse(i.toObject()))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: AppDemoDTOListRequest) {
    return new AppDemoDTOListResponse(await this.demoService.list(payload))
  }
}
