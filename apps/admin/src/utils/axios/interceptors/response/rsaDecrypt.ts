import type { ResponseBase } from '@walnut/contract'
import type { AxiosResponse } from 'axios'
import { SingletonPromise } from '@walnut/client/queue'
import { useAppStoreSecurity } from '@/store/modules/app/app-security'

const appStoreSecurity = useAppStoreSecurity()
const capJSQueue = new SingletonPromise<string>()

export function SingletonPromiseRsaDecryptFailed(res: AxiosResponse<ResponseBase<{ id: string }>, any>) {
  return capJSQueue.run(async () => {
    // clear server rsa pub key
    appStoreSecurity.clearServerRsaPubKey()

    const newRsaPubKey = await appStoreSecurity.getServerRsaPubKey()

    // put back original post data
    res.config.data = res.config._plainData

    return newRsaPubKey
  })
}
