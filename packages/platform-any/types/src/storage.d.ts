export interface IStorageSync extends Storage {}

// 这里必须是 `Omit` 而不是 `Exclude`：`Exclude` 作用在**联合类型**上，而 `Storage` 是接口
// ⇒ `Exclude<Storage, 'getItem' | 'setItem'>` 原样返回 `Storage`，于是下面两行等于用不兼容的签名
// 去覆盖父接口的成员（`tsc` 报 TS2430，而 `skipLibCheck` 把这条错误藏了很久）。
export interface IStorageAsync extends Omit<Storage, 'getItem' | 'setItem'> {
  getItem: (key: string) => string | null | Promise<string | null>
  setItem: (key: string, value: string) => void | Promise<void>
}

export interface IStorageOptions<T> {
  /**
   * expire time（milliseconds），Infinity means never expire
   * @default Infinity
   */
  expire?: number
  /**
   * any object that implements the Storage interface
   * @default syncLocalStorage/asyncLocalStorage
   */
  storage?: T
  /**
   * whether to use preset key
   * @default true
   */
  usePresetKey?: boolean
  /**
   * ttl mode
   * @default 'fixed'
   */
  ttlMode?: 'fixed' | 'sliding'
  /**
   * reset behavior
   * @default 'clear'
   */
  resetBehavior?: 'clear' | 'keepInitial'
}

export interface IStorageData<T> {
  /** real value */
  v: T

  /** app version */
  _v: string

  /** expire time (milliseconds)，null means won't expire */
  e: number | null
}
