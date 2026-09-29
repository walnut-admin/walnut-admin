import { SingletonPromise } from '@walnut/utils/queue'
import { useAppStoreSecurity } from '@/store/modules/app/app-security'

const appStoreSecurity = useAppStoreSecurity()
const rsaPubKeyNotFoundQueue = new SingletonPromise<void>()

export function SingletonPromiseRsaPubKeyNotFound() {
  return rsaPubKeyNotFoundQueue.run(async () => {
    return await appStoreSecurity.sendRsaPubKeyToServer(false)
  })
}
