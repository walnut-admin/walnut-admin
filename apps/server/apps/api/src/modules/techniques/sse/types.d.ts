declare global {
  interface IWalnutAdminSseClientData<T = any> {
    success: boolean
    message: string
    data: T
  }
}

export {}
