import { AuthRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

/**
 * @description get github oauth uri
 */
export function getGitHubURIAPI() {
  return AppAxios.get<string>({
    url: AuthRoutes.OAUTH_GITHUB_URL,
  })
}

/**
 * @description get gitee oauth uri
 */
export function getGiteeURIAPI() {
  return AppAxios.get<string>({
    url: AuthRoutes.OAUTH_GITEE_URL,
  })
}
