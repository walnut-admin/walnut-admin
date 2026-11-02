import { SecurityRoutes } from '@walnut/contract'
import { useAppEnvProxy } from '@/hooks/app/useAppEnv'

const { httpUrl } = useAppEnvProxy()

export const securityCapApiEndpoint = `${httpUrl}${SecurityRoutes.CAP}/`
