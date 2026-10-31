import { CacheModule } from '@nestjs/cache-manager'
import { Global, Module } from '@nestjs/common'
import { CacheConfigService } from './cache.config.service'
import { AppTechCacheService } from './cache.service'
import { AppTechCacheAppSettingsService } from './service/cache.appSettings'
import { AppTechCacheCapService } from './service/cache.cap'
import { AppTechCacheDeviceService } from './service/cache.device'
import { AppTechCacheLockService } from './service/cache.lock'
import { AppTechCacheMfaService } from './service/cache.mfa'
import { AppTechCacheOpaqueService } from './service/cache.opaque'
import { AppTechCachePermissionsService } from './service/cache.permissions'
import { AppTechCacheRsaService } from './service/cache.rsa'
import { AppTechCacheSignService } from './service/cache.sign'
import { AppTechCacheVerifyCodeService } from './service/cache.verifyCode'

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      useClass: CacheConfigService,
      isGlobal: true,
    }),
  ],
  controllers: [],
  providers: [
    AppTechCacheService,
    AppTechCacheAppSettingsService,
    AppTechCachePermissionsService,
    AppTechCacheSignService,
    AppTechCacheRsaService,
    AppTechCacheLockService,
    AppTechCacheVerifyCodeService,
    AppTechCacheMfaService,
    AppTechCacheOpaqueService,
    AppTechCacheCapService,
    AppTechCacheDeviceService,
  ],
  exports: [
    AppTechCacheService,
    AppTechCacheAppSettingsService,
    AppTechCachePermissionsService,
    AppTechCacheSignService,
    AppTechCacheRsaService,
    AppTechCacheLockService,
    AppTechCacheVerifyCodeService,
    AppTechCacheMfaService,
    AppTechCacheOpaqueService,
    AppTechCacheCapService,
    AppTechCacheDeviceService,
  ],
})
export class AppTechCacheModule {}
