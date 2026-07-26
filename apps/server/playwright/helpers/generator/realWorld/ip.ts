/**
 * 真实世界IP地址随机生成器
 *
 * 推荐下载文件:
 * IPv4: https://cdn.jsdelivr.net/npm/@ip-location-db/geo-whois-asn-country/geo-whois-asn-country-ipv4.csv
 * IPv6: https://cdn.jsdelivr.net/npm/@ip-location-db/geo-whois-asn-country/geo-whois-asn-country-ipv6.csv
 *
 * 使用 csv-parser 解析CSV
 * npm install csv-parser @types/node
 */

import * as fs from 'node:fs'
import { parse } from 'csv-parse'

interface IPRange {
  start: bigint
  end: bigint
  country: string
}

class RealIPGenerator {
  private ipv4Ranges: IPRange[] = []
  private ipv6Ranges: IPRange[] = []
  private countryIPv4Cache: Map<string, IPRange[]> = new Map()
  private countryIPv6Cache: Map<string, IPRange[]> = new Map()

  // 静态缓存：文件路径 -> 加载的数据
  private static fileCache: Map<string, { version: 4 | 6, ranges: IPRange[] }> = new Map()
  private ipv4Loaded = false
  private ipv6Loaded = false

  /**
   * 从CSV文件加载IP数据
   * @param filePath CSV文件路径
   * @param version IP版本 (4 或 6)
   * @param forceReload 是否强制重新加载（忽略缓存）
   */
  async loadFromCSV(filePath: string, version: 4 | 6 = 4, forceReload: boolean = false): Promise<void> {
    // 检查是否已经加载过该版本
    if (version === 4 && this.ipv4Loaded && !forceReload) {
      console.log(`⚠️  IPv4 数据已加载，跳过重复加载`)
      return
    }
    if (version === 6 && this.ipv6Loaded && !forceReload) {
      console.log(`⚠️  IPv6 数据已加载，跳过重复加载`)
      return
    }

    // 检查静态缓存
    const cacheKey = `${filePath}:${version}`
    if (RealIPGenerator.fileCache.has(cacheKey) && !forceReload) {
      const cached = RealIPGenerator.fileCache.get(cacheKey)!
      if (version === 4) {
        this.ipv4Ranges = [...cached.ranges]
        this.ipv4Loaded = true
      }
      else {
        this.ipv6Ranges = [...cached.ranges]
        this.ipv6Loaded = true
      }
      console.log(`✓ 从缓存加载 ${cached.ranges.length.toLocaleString()} 个IPv${version}地址段`)
      return
    }

    // 清空对应版本的数据（防止重复加载）
    const ranges: IPRange[] = []

    return new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(parse({}))
        .on('data', (row: any) => {
          try {
            const startIP = row['0']
            const endIP = row['1']
            const country = row['2']

            if (!startIP || !endIP || !country)
              return

            const start = version === 4
              ? this.ipv4ToBigInt(startIP)
              : this.ipv6ToBigInt(startIP)
            const end = version === 4
              ? this.ipv4ToBigInt(endIP)
              : this.ipv6ToBigInt(endIP)

            ranges.push({ start, end, country: country.trim() })
          }
          catch (e) {
            console.error(e)
          }
        })
        .on('end', () => {
          // 保存到实例
          if (version === 4) {
            this.ipv4Ranges = ranges
            this.ipv4Loaded = true
            this.countryIPv4Cache.clear() // 清空国家缓存
          }
          else {
            this.ipv6Ranges = ranges
            this.ipv6Loaded = true
            this.countryIPv6Cache.clear() // 清空国家缓存
          }

          // 保存到静态缓存
          RealIPGenerator.fileCache.set(cacheKey, { version, ranges })

          console.log(`✓ 已加载 ${ranges.length.toLocaleString()} 个IPv${version}地址段`)
          resolve()
        })
        .on('error', reject)
    })
  }

  /**
   * 清除静态缓存
   */
  static clearCache(): void {
    RealIPGenerator.fileCache.clear()
    console.log('✓ 已清除所有静态缓存')
  }

  /**
   * 获取一个随机的真实世界IP地址
   * @param version IP版本 (4 或 6)
   * @param country 可选的国家代码过滤 (如 'US', 'CN', 'JP')
   */
  getRandomIP(version: 4 | 6 = 4, country?: string): { ip: string, country: string } {
    let ranges = version === 4 ? this.ipv4Ranges : this.ipv6Ranges

    if (ranges.length === 0) {
      throw new Error(`没有可用的IPv${version}数据，请先调用loadFromCSV方法加载数据`)
    }

    // 如果指定了国家，使用缓存或筛选
    if (country) {
      country = country.toUpperCase()
      const cache = version === 4 ? this.countryIPv4Cache : this.countryIPv6Cache

      if (!cache.has(country)) {
        const filtered = ranges.filter(r => r.country === country)
        cache.set(country, filtered)
      }

      const filteredRanges = cache.get(country)!
      if (filteredRanges.length === 0) {
        throw new Error(`没有找到国家代码为 ${country} 的IP范围`)
      }
      ranges = filteredRanges
    }

    const range = ranges[Math.floor(Math.random() * ranges.length)]
    const randomInt = this.randomBigInt(range.start, range.end)
    const randomIP = version === 4
      ? this.bigIntToIPv4(randomInt)
      : this.bigIntToIPv6(randomInt)

    return {
      ip: randomIP,
      country: range.country,
    }
  }

  /**
   * 批量生成随机真实IP地址
   * @param count 生成数量
   * @param version IP版本 (4 或 6)
   * @param country 可选的国家代码过滤
   * @param unique 是否保证IP地址唯一
   */
  getRandomIPs(
    count: number = 10,
    version: 4 | 6 = 4,
    country?: string,
    unique: boolean = false,
  ): Array<{ ip: string, country: string }> {
    if (unique) {
      const ips = new Set<string>()
      const results: Array<{ ip: string, country: string }> = []

      while (results.length < count) {
        const result = this.getRandomIP(version, country)
        if (!ips.has(result.ip)) {
          ips.add(result.ip)
          results.push(result)
        }
      }
      return results
    }
    else {
      return Array.from({ length: count }, () => this.getRandomIP(version, country))
    }
  }

  private ipv4ToBigInt(ip: string): bigint {
    const parts = ip.split('.').map(Number)
    if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) {
      throw new Error(`无效的IPv4地址: ${ip}`)
    }
    return BigInt(parts[0]) * 16777216n
      + BigInt(parts[1]) * 65536n
      + BigInt(parts[2]) * 256n
      + BigInt(parts[3])
  }

  private bigIntToIPv4(num: bigint): string {
    const a = Number(num / 16777216n)
    const b = Number((num % 16777216n) / 65536n)
    const c = Number((num % 65536n) / 256n)
    const d = Number(num % 256n)
    return `${a}.${b}.${c}.${d}`
  }

  private ipv6ToBigInt(ip: string): bigint {
    // 展开IPv6简写形式
    let expanded = ip
    if (ip.includes('::')) {
      const parts = ip.split('::')
      const left = parts[0] ? parts[0].split(':') : []
      const right = parts[1] ? parts[1].split(':') : []
      const missing = 8 - left.length - right.length
      const middle = Array.from({ length: missing }, () => '0')
      expanded = [...left, ...middle, ...right].join(':')
    }

    const parts = expanded.split(':')
    if (parts.length !== 8) {
      throw new Error(`无效的IPv6地址: ${ip}`)
    }

    let result = 0n
    for (const part of parts) {
      const hex = part || '0'
      result = result * 65536n + BigInt(Number.parseInt(hex, 16))
    }
    return result
  }

  private bigIntToIPv6(num: bigint): string {
    const parts: string[] = []
    for (let i = 0; i < 8; i++) {
      parts.unshift((num % 65536n).toString(16))
      num = num / 65536n
    }

    // 简化连续的0
    let result = parts.join(':')
    result = result.replace(/\b0+([0-9a-f]+)/g, '$1')
    result = result.replace(/(?:^|:)0(?::0)+(?:$|:)/g, '::')

    return result
  }

  private randomBigInt(min: bigint, max: bigint): bigint {
    const range = max - min + 1n
    const bits = range.toString(2).length

    let result: bigint
    do {
      result = 0n
      for (let i = 0; i < bits; i++) {
        result = result * 2n + (Math.random() < 0.5 ? 0n : 1n)
      }
    } while (result >= range)

    return min + result
  }
}

export default { RealIPGenerator }

export async function generateRandomIP() {
  const generator = new RealIPGenerator()
  await generator.loadFromCSV('playwright/helpers/generator/realWorld/assets/geo-whois-asn-country-ipv4.csv')
  await generator.loadFromCSV('playwright/helpers/generator/realWorld/assets/geo-whois-asn-country-ipv6.csv')
  const res = generator.getRandomIP()
  return res.ip
}
