import { SingletonPromise } from '@walnut/utils/queue'
import { useAppStoreSecurity } from '@/store/modules/app/app-security'

const appStoreSecurity = useAppStoreSecurity()
const signQueue = new SingletonPromise<string | null>()

export function SingletonPromiseSign() {
  return signQueue.run(async () => {
    return await appStoreSecurity.getSignAesKey()
  })
}
