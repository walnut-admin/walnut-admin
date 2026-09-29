import type { NDateLocale, NLocale } from 'naive-ui'
import { dateZhCN, zhCN } from 'naive-ui'
import { computed } from 'vue'
import { AppConstLocale } from '@/const/app'
import { useAppStoreLocale } from '@/store/modules/app/app-locale'

const appStoreLocale = useAppStoreLocale()

export const getLocale = computed((): NLocale | undefined =>
  appStoreLocale.getLocale === AppConstLocale.EN_US ? undefined : zhCN,
)
export const getDateLocale = computed((): NDateLocale | undefined =>
  appStoreLocale.getLocale === AppConstLocale.EN_US ? undefined : dateZhCN,
)
