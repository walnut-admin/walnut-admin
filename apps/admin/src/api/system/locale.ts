import type { SystemLocale } from '@walnut/api-types'
import type { Recordable } from 'easy-fns-ts'
import type { ValueOfAppConstLocale } from '@/const/app'
import { SystemEndpointRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'
import { BaseAPI } from '../base'

export const localeAPI = new BaseAPI<SystemLocale>({
  model: 'system',
  section: 'locale',
})

/**
 * @description get locale messages from back end by language
 * Called 1: app i18n init
 * Called 2: change language, need to request for new messages by new language
 */
export function getI18nMsgAPI(lang: ValueOfAppConstLocale, cache = 1) {
  return AppAxios.get<Recordable>({
    url: `${SystemEndpointRoutes.LOCALE_MESSAGE}/${lang}`,
    params: {
      cache,
    },
  })
}
