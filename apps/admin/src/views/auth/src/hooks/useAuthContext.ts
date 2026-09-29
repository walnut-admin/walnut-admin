import type { AuthContext } from '../types'
import { useContext } from '@walnut/client/hooks/core/useContext'
import { AppConstSymbolKey } from '@/const/symbol'

export const { setContext: setAuthContext, getContext: useAuthContext }
  = useContext<AuthContext>(Symbol(AppConstSymbolKey.AUTH_KEY))
