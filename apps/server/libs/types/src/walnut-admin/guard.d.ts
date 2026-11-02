declare global {
  interface IWalnutAdminThrottleConfigProvider {
    getThrottleLimit: () => number | Promise<number>
    getThrottleTtl: () => number | Promise<number>
  }

  interface IWalnutAdminOtpThrottleConfigProvider<T = string> {
    getThrottleLimit: (type: T) => number | Promise<number>
    getThrottleTtl: (type: T) => number | Promise<number>
  }
}

export {}
