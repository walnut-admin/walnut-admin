import type { SystemRole } from '@walnut/api-types'
import { BaseAPI } from '../base'

export const roleAPI = new BaseAPI<SystemRole>({
  model: 'system',
  section: 'role',
})
