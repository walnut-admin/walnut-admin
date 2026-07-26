import type { IncomingMessage } from 'node:http'

interface ISocketRequest extends IWalnutAdminExpressRequest, IncomingMessage {}
