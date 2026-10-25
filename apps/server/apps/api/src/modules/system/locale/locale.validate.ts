import { Injectable } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'

@ValidatorConstraint({ name: 'LocaleLangIdValidate', async: true })
@Injectable()
export class LocaleLangIdValidate implements ValidatorConstraintInterface {
  constructor(private readonly cacheService: AppTechCacheService) {}

  // B2 迁移：缓存里的 lang id 与入参 langId 都是 uuid 字符串（原 ObjectId 十六进制比对
  // 随迁移同步换），缓存写入点见 locale.shared.service.extractLangIdsIntoCache
  async validate(langId: string, _args: ValidationArguments) {
    const langIds = await this.cacheService.get<string[] | null>(
      WalnutAdminConstAppCacheKeys.SYS_LANG_ID_LIST,
    )

    if (!langIds || langIds.length === 0)
      return true

    return langIds.includes(langId)
  }

  defaultMessage(_validationArguments?: ValidationArguments): string {
    return 'Invalid of langId'
  }
}
