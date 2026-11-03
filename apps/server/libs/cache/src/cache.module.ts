import { CacheModule } from '@nestjs/cache-manager'
import { Global, Module } from '@nestjs/common'
import { CacheConfigService } from './cache.config.service'
import { AppTechCacheService } from './cache.service'
import { AppTechCacheAppSettingsService } from './service/appSettings.cache'
import { AppTechCacheCronLockService } from './service/cache.cron-lock'
import { AppTechCacheLockService } from './service/cache.lock'
import { AppTechCacheRsaService } from './service/cache.rsa'
import { AppTechCacheCapService } from './service/cap.cache'
import { AppTechCacheDeviceService } from './service/device.cache'
import { AppTechCacheMfaService } from './service/mfa.cache'
import { AppTechCacheOpaqueService } from './service/opaque.cache'
import { AppTechCachePermissionsService } from './service/permissions.cache'
import { AppTechCacheSignService } from './service/sign.cache'
import { AppTechCacheVerifyCodeService } from './service/verifyCode.cache'

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
    AppTechCacheCronLockService,
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
    AppTechCacheCronLockService,
  ],
})
export class AppTechCacheModule {}
