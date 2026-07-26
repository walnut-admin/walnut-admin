import { Injectable } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys } from '@walnut/const/app/cache'
import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator'
import { Types } from 'mongoose'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'

@ValidatorConstraint({ name: 'LocaleLangIdValidate', async: true })
@Injectable()
export class LocaleLangIdValidate implements ValidatorConstraintInterface {
  constructor(private readonly cacheService: AppTechCacheService) {}

  // mongo db id has transformed before, so the value here is objectId
  async validate(langId: Types.ObjectId, _args: ValidationArguments) {
    const langIds = await this.cacheService.get<string[] | null>(
      WalnutAdminConstAppCacheKeys.SYS_LANG_ID_LIST,
    )

    if (!langIds || langIds.length === 0)
      return true

    return langIds.includes(langId.toHexString())
  }

  defaultMessage(_validationArguments?: ValidationArguments): string {
    return 'Invalid of langId'
  }
}
