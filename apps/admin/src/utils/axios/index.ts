import { Axios } from '@walnut/http/instance'
import { originalConfig } from './core/config'
import { AxiosTransform } from './interceptors'

// app axios instance
export const AppAxios = new Axios({
  originalConfig,

  transformers: AxiosTransform,
})
