import type { Observable } from 'rxjs'
import { Injectable, NotFoundException } from '@nestjs/common'
import { Subject } from 'rxjs'

// Note: IWalnutAdminSseClientData interface is declared ambient (declare global) in
// this lib's types.d.ts

/**
 * 一条 SSE 订阅连接的句柄（F-04 / F-40，2026-11-01）。
 *
 * 旧 API 把「频道键」当连接用：`createClient(key)` 直接覆盖同名 Subject，
 * `disconnectClient(key)` 按 key 删除。后果有两层：
 * - 同 key 的第二条连接顶掉第一条（第一条的流被静默丢弃，第一条的 Subject 泄漏）；
 * - 第一条关闭时按 key 删除，删掉的却是第二条的 Subject（多标签页自伤）；
 * - 键可由调用方自选时（OAuth SSE 曾用客户端指纹头），攻击者还能连续抢注把投递黑洞掉。
 *
 * 现在连接是显式句柄：同 key 的连接**复用**同一个 Subject（同频道的订阅者都能收到），
 * `close()` 只释放**自己那一份**引用，最后一个连接关闭时才 complete 并移除频道。
 */
export interface IWalnutAdminSseClientConnection {
  /**
   * @description channel key, derived by the caller from a server-trusted source
   */
  readonly clientId: string

  /**
   * @description 释放本连接；幂等，且不影响同频道的其它连接
   */
  close: () => void
}

interface IWalnutAdminSseClientEntry {
  subject: Subject<IWalnutAdminSseClientData>
  refs: number
}

@Injectable()
export class AppTechSseService {
  private readonly clients = new Map<string, IWalnutAdminSseClientEntry>()

  /**
   * @description create the channel for client id, or reuse the registered one (idempotent)
   */
  createClient(clientId: string): IWalnutAdminSseClientConnection {
    const entry = this.clients.get(clientId) ?? {
      subject: new Subject<IWalnutAdminSseClientData>(),
      refs: 0,
    }

    entry.refs += 1
    this.clients.set(clientId, entry)

    let released = false

    return {
      clientId,
      close: () => {
        if (released) {
          return
        }

        released = true
        this.releaseClient(clientId, entry)
      },
    }
  }

  /**
   * @description send message to specific client
   * @returns whether anyone is listening on that channel
   */
  sendToClient(clientId: string, data: IWalnutAdminSseClientData): boolean {
    const entry = this.clients.get(clientId)

    if (!entry) {
      return false
    }

    entry.subject.next(data)

    return true
  }

  /**
   * @description get Observable for client
   * @throws NotFoundException when the channel is not registered
   */
  getClientObservable(clientId: string): Observable<IWalnutAdminSseClientData> {
    const entry = this.clients.get(clientId)

    if (!entry) {
      // F-40：旧实现回退 `new Observable()` —— 既不发射也不 complete，订阅方静默挂死。
      // 注册与取流是一对必须相邻的操作（@Sse handler 里 createClient 紧跟本调用），
      // 时序错位必须立刻可见，而不是变成一条永不产出的流。
      throw new NotFoundException('sse client is not registered')
    }

    return entry.subject.asObservable()
  }

  /**
   * @description 释放一条连接：仅当同频道已无连接时才终结 Subject 并移除频道
   */
  private releaseClient(clientId: string, entry: IWalnutAdminSseClientEntry): void {
    entry.refs -= 1

    if (entry.refs > 0) {
      return
    }

    entry.subject.complete()

    // 只删仍指向本 entry 的注册项：期间若有新连接建了新 entry，不能被旧句柄的 close 删掉
    if (this.clients.get(clientId) === entry) {
      this.clients.delete(clientId)
    }
  }
}
