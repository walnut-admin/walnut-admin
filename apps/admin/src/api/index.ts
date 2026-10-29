import type { AppBackendDeps } from '@walnut/api-types'
import type { AxiosRequestConfig } from 'axios'
import { AppRoutes, AuthRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

export function HelloAPI(config: AxiosRequestConfig<string, string>) {
  return AppAxios.get<string>(
    {
      url: '',
      ...config,
    },
  )
}

export function HelloWithTokenAPI(config: AxiosRequestConfig<string, string>) {
  return AppAxios.get<string>(
    {
      url: AuthRoutes.BASE,
      ...config,
    },
  )
}

export function BackendDepsAPI() {
  return AppAxios.get<AppBackendDeps>(
    {
      url: AppRoutes.DEPS,
    },
  )
}
