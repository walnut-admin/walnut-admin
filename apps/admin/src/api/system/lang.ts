import type { SystemLang, SystemLangPublicListItem } from '@walnut/api-types'
import { SystemEndpointRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'
import { BaseAPI } from '../base'

export const langAPI = new BaseAPI<SystemLang>({
  model: 'system',
  section: 'lang',
})

/**
 * @description get language lists from back end, used for language change
 * This should only called once in appStoreLocalePicker component
 */
export async function getLangListPublicAPI() {
  const lists = await AppAxios.get<SystemLangPublicListItem[]>({
    url: SystemEndpointRoutes.LANG_LIST_PUBLIC,
  })

  return lists.map(i => ({
    value: i.lang!,
    label: i.description!,
  }))
}
