import { Injectable } from '@nestjs/common'
import { Observable, Subject } from 'rxjs'

// Note: IWalnutAdminSseClientData interface has been moved to @walnut/types/walnut-admin/sse.d.ts
// as IWalnutAdminSseClientData

@Injectable()
export class AppTechSseService {
  private clients: Map<string, Subject<any>> = new Map()

  // create new Subject for client
  createClient(clientId: string): Subject<any> {
    const subject = new Subject<any>()
    this.clients.set(clientId, subject)
    return subject
  }

  // send message to specfic client
  sendToClient(clientId: string, data: IWalnutAdminSseClientData): void {
    const subject = this.clients.get(clientId)
    if (subject) {
      subject.next(data)
    }
  }

  // get Observable for client
  getClientObservable(clientId: string): Observable<any> {
    return this.clients.get(clientId)?.asObservable() || new Observable()
  }

  // disconnect client
  disconnectClient(clientId: string): void {
    const subject = this.clients.get(clientId)
    if (subject) {
      subject.complete()
      this.clients.delete(clientId)
    }
  }
}
