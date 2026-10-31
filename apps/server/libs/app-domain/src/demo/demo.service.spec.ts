import type { EntityManager } from 'typeorm'
import { describe, expect, it } from 'vitest'
import { AppDemoService } from './demo.service'

/**
 * B1 迁移模板（service 层）的编排契约：demo 是**纯透传** service —— 它存在的意义是
 * 给 controller 一个稳定的注入点，同时把事务句柄 `em` 原样传给 repo。这里钉住
 * 「参数不多不少、em 不丢」：repo 层行为由 int-spec 覆盖，单测只测这一层。
 */
class FakeDemoRepo {
  readonly calls: Array<{ method: string, args: unknown[] }> = []

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args })
  }

  async create(payload: unknown) {
    this.record('create', [payload])
    return { id: 'demo-created' }
  }

  async readById(id: string) {
    this.record('readById', [id])
    return { id, demoString: 'DEMO' }
  }

  async update(id: string, payload: unknown) {
    this.record('update', [id, payload])
    return { id, demoString: 'UPDATED' }
  }

  async deleteSoftById(id: string, userId: string, em?: EntityManager) {
    this.record('deleteSoftById', [id, userId, em])
    return true
  }

  async deleteSoftByIdMany(ids: string[], userId: string, em?: EntityManager) {
    this.record('deleteSoftByIdMany', [ids, userId, em])
    return ids.length
  }

  async list(payload: unknown) {
    this.record('list', [payload])
    return { data: [], total: 0 }
  }
}

function createService() {
  const repo = new FakeDemoRepo()
  const service = new AppDemoService(repo as never)
  return { repo, service }
}

const EM = { marker: 'entity-manager' } as unknown as EntityManager

describe('appDemoService 透传契约', () => {
  it('create / read / update / list 原样转发参数', async () => {
    const { repo, service } = createService()
    const createPayload = { demoString: 'X' } as never
    const updatePayload = { demoString: 'Y' } as never
    const listPayload = { page: { page: 1, pageSize: 10 } } as never

    await expect(service.create(createPayload)).resolves.toEqual({ id: 'demo-created' })
    await expect(service.read('demo-1')).resolves.toMatchObject({ id: 'demo-1' })
    await expect(service.update('demo-1', updatePayload)).resolves.toMatchObject({ demoString: 'UPDATED' })
    await expect(service.list(listPayload)).resolves.toEqual({ data: [], total: 0 })

    expect(repo.calls).toEqual([
      { method: 'create', args: [createPayload] },
      { method: 'readById', args: ['demo-1'] },
      { method: 'update', args: ['demo-1', updatePayload] },
      { method: 'list', args: [listPayload] },
    ])
  })

  it('delete 透传 id / userId / em', async () => {
    const { repo, service } = createService()

    await expect(service.delete('demo-1', 'user-1', EM)).resolves.toBe(true)

    expect(repo.calls).toEqual([
      { method: 'deleteSoftById', args: ['demo-1', 'user-1', EM] },
    ])
  })

  it('deleteMany 透传整组 id / userId / em', async () => {
    const { repo, service } = createService()
    const ids = ['demo-1', 'demo-2']

    await expect(service.deleteMany(ids, 'user-2', EM)).resolves.toBe(2)

    expect(repo.calls).toEqual([
      { method: 'deleteSoftByIdMany', args: [ids, 'user-2', EM] },
    ])
  })
})
