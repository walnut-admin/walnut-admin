import { useStoreCompCapJS } from '@/store/modules/component/comp-capjs'
import { createAsyncComponent } from '@/utils/factory/asyncComponent'

const compStoreCapJS = useStoreCompCapJS()

export default createAsyncComponent(async () => {
  await compStoreCapJS.loadCap()
  return import('./index.vue')
})
