import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { RealPartialType } from '@walnut-server/utils/dto'

import { CacheKeyStrategy, MenuTernal, MenuType } from '@walnut/contract/menu'
import { Expose } from 'class-transformer'
import { Recordable } from 'easy-fns-ts'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export class SysMenuModelMeta {
  @WalnutAdminDecoratorFieldNumber({
    default: null,
    swaggerOptions: {
      title: 'menu order',
      description: 'should be int',
    },
    validateOptions: { int: true },
  })
  order: number

  @WalnutAdminDecoratorFieldEnum(() => MenuTernal, {
    default: MenuTernal.NONE,
    swaggerOptions: {
      title: 'menu ternal type',
      description:
        'internal => no jump, iframe inside page. external => jump url, need to confirm',
      example: MenuTernal.NONE,
    },
  })
  ternal: typeof MenuTernal[keyof typeof MenuTernal]

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'ternal url',
      description: 'should be a full and real url',
    },
    validateOptions: {
      url: true,
    },
  })
  url: string

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'menu show status',
      description:
        'false => will be filtered in front end. set this false when need to hide a page like detail which not necessary in menu and tabs',
    },
  })
  show: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'menu cache status',
      description: 'true => will be cached in keep-alive',
    },
  })
  cache: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'menu status',
      description: 'false => will not be retrieved from database',
    },
  })
  status: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'tab status',
      description: 'true => tab will be affixed in left/right',
    },
  })
  affix: boolean

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'permission string',
      description: 'permission string, mostly like *:*:*',
    },
  })
  permission: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'menu active name',
      description:
        'used for show=false page, tell front end to active which menu when show=false page is opened',
    },
  })
  menuActiveName: string

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'menu active same tab',
      description:
        'mostly used with `menuActiveName`, true => no new tab for show=false page',
    },
  })
  menuActiveSameTab: boolean

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'menu badge',
      description:
        'menu badge, normally red dot or a number or a ???character',
    },
  })
  badge: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'menu active icon',
      description:
        'show different icon when menu is activited, icon show follow iconify and unocss rules',
    },
  })
  activeIcon: string

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'page scroll position status',
      description: 'true => remember scroll postion for the user',
    },
  })
  position: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'page leave tip',
      description:
        'true => will show a leave confirm message modal to make sure ready to leave current page',
    },
  })
  leaveTip: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'browser url masking, including path/params/query',
    },
  })
  maskUrl: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'hijack refresh token',
      description:
        'true => will hijack refresh token in front end',
    },
  })
  hijackRefresh: boolean

  @WalnutAdminDecoratorFieldObject(Object, {
    validateOptions: {
      any: true,
    },
  })
  watermark: Recordable

  @WalnutAdminDecoratorFieldString({
    default: 'fade',
    swaggerOptions: {
      title: 'transition name',
      description:
        'used for vue transition name',
    },
  })
  transition: string

  @WalnutAdminDecoratorFieldEnum(() => CacheKeyStrategy, {
    default: null,
    swaggerOptions: {
      title: 'cache key strategy',
      description:
        'name => use menu name as cache key. path => use menu path as cache key',
      example: CacheKeyStrategy.NAME,
    },
  })
  cacheKeyStrategy: typeof CacheKeyStrategy[keyof typeof CacheKeyStrategy]
}

export class SysMenuModel extends WalnutAdminCommonBasicModel {
  @Expose()
  // B5：pid 随 PG 列型放开为可空 uuid（根节点 pid=NULL，phase2 4.3；IsMongoId 约束在
  // DTO 子类用 uuid 校验整体替换，见 dto/menu.dto.ts）
  pid: string | null

  @WalnutAdminDecoratorFieldEnum(() => MenuType, {
    default: MenuType.CATALOG,
    swaggerOptions: {
      title: 'basic menu type, mostly used in front end',
      description:
        'catalog => like folder, can only have child nodes. menu => refer to route. element => front end element permission',
      example: MenuType.CATALOG,
    },
  })
  type: typeof MenuType[keyof typeof MenuType]

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'route path',
      description: 'used for vue router path',
    },
  })
  path: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'route name',
      description:
        'used for vue router name, should be unique, also used for keep-alive flags',
    },
  })
  name: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'route component file path',
      description: 'used for vue router to find target file path',
    },
  })
  component: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'route title',
      description: 'used for route page title, mostly is i18n format',
    },
  })
  title: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'route icon',
      description: 'used for route icon, shown in menus and tabs',
    },
  })
  icon: string

  @WalnutAdminDecoratorFieldObject(RealPartialType(SysMenuModelMeta), {
    swaggerOptions: {
      title: 'menu meta data, lots of fields',
    },
  })
  meta: SysMenuModelMeta
}
