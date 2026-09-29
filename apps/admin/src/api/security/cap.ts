import { useAppEnvProxy } from '@/hooks/app/useAppEnv'

const { httpUrl } = useAppEnvProxy()

export const securityCapApiEndpoint = `${httpUrl}/security/cap/`
