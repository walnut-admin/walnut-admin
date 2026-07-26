/**
 * 浏览器 Locale 生成器
 * 用于获取和模拟浏览器的完整 locale 支持列表
 */

interface LocaleInfo {
  locale: string
  language: string
  region?: string
  script?: string
  displayName: string
}

interface BrowserLocaleConfig {
  locale: string
  languages: string[]
  timeZone: string
}

export class BrowserLocaleGenerator {
  /**
   * 获取所有可用的 locale 列表
   * 基于 Intl.DateTimeFormat 支持的 locale
   */
  static getAllLocales(): string[] {
    // 使用 Intl.DateTimeFormat.supportedLocalesOf 获取支持的 locale
    const testLocales = [
      // 主要语言
      'en-US',
      'en-GB',
      'en-AU',
      'en-CA',
      'en-NZ',
      'en-IE',
      'en-ZA',
      'en-IN',
      'zh-CN',
      'zh-TW',
      'zh-HK',
      'zh-SG',
      'ja-JP',
      'ko-KR',
      'fr-FR',
      'fr-CA',
      'fr-BE',
      'fr-CH',
      'de-DE',
      'de-AT',
      'de-CH',
      'es-ES',
      'es-MX',
      'es-AR',
      'es-CO',
      'es-CL',
      'es-PE',
      'it-IT',
      'it-CH',
      'pt-BR',
      'pt-PT',
      'ru-RU',
      'ar-SA',
      'ar-EG',
      'ar-AE',
      'hi-IN',
      'th-TH',
      'vi-VN',
      'id-ID',
      'ms-MY',
      'tr-TR',
      'pl-PL',
      'nl-NL',
      'nl-BE',
      'sv-SE',
      'da-DK',
      'fi-FI',
      'no-NO',
      'cs-CZ',
      'hu-HU',
      'ro-RO',
      'uk-UA',
      'el-GR',
      'he-IL',
      'fa-IR',
      'bn-BD',
      'bn-IN',
      'ur-PK',
      'ta-IN',
      'te-IN',
      'mr-IN',
      'kn-IN',
      'ml-IN',
      'gu-IN',
      'pa-IN',
      // 更多变体
      'en',
      'zh',
      'ja',
      'ko',
      'fr',
      'de',
      'es',
      'it',
      'pt',
      'ru',
      'ar',
    ]

    // 过滤出系统实际支持的 locale
    const supported = Intl.DateTimeFormat.supportedLocalesOf(testLocales, {
      localeMatcher: 'lookup',
    })

    return Array.from(new Set(supported)).sort()
  }

  /**
   * 获取详细的 locale 信息
   */
  static getLocaleInfo(locale: string): LocaleInfo {
    const parts = locale.split('-')
    const language = parts[0]
    const region = parts.length > 1 ? parts[parts.length - 1] : undefined
    const script = parts.length > 2 ? parts[1] : undefined

    let displayName = locale
    try {
      // 尝试获取显示名称
      const displayNames = new Intl.DisplayNames([locale], { type: 'language' })
      displayName = displayNames.of(locale) || locale
    }
    catch (e) {
      console.error(e)
      // 如果失败，使用 locale 本身
    }

    return {
      locale,
      language,
      region,
      script,
      displayName,
    }
  }

  /**
   * 获取常用的浏览器 locale 配置列表
   */
  static getCommonBrowserLocales(): BrowserLocaleConfig[] {
    return [
      // 英语系
      {
        locale: 'en-US',
        languages: ['en-US', 'en'],
        timeZone: 'America/New_York',
      },
      {
        locale: 'en-GB',
        languages: ['en-GB', 'en'],
        timeZone: 'Europe/London',
      },
      {
        locale: 'en-AU',
        languages: ['en-AU', 'en'],
        timeZone: 'Australia/Sydney',
      },
      // 中文系
      {
        locale: 'zh-CN',
        languages: ['zh-CN', 'zh'],
        timeZone: 'Asia/Shanghai',
      },
      {
        locale: 'zh-TW',
        languages: ['zh-TW', 'zh'],
        timeZone: 'Asia/Taipei',
      },
      {
        locale: 'zh-HK',
        languages: ['zh-HK', 'zh'],
        timeZone: 'Asia/Hong_Kong',
      },
      // 日语
      {
        locale: 'ja-JP',
        languages: ['ja-JP', 'ja', 'en'],
        timeZone: 'Asia/Tokyo',
      },
      // 韩语
      {
        locale: 'ko-KR',
        languages: ['ko-KR', 'ko', 'en'],
        timeZone: 'Asia/Seoul',
      },
      // 法语
      {
        locale: 'fr-FR',
        languages: ['fr-FR', 'fr', 'en'],
        timeZone: 'Europe/Paris',
      },
      // 德语
      {
        locale: 'de-DE',
        languages: ['de-DE', 'de', 'en'],
        timeZone: 'Europe/Berlin',
      },
      // 西班牙语
      {
        locale: 'es-ES',
        languages: ['es-ES', 'es', 'en'],
        timeZone: 'Europe/Madrid',
      },
      {
        locale: 'es-MX',
        languages: ['es-MX', 'es', 'en'],
        timeZone: 'America/Mexico_City',
      },
      // 意大利语
      {
        locale: 'it-IT',
        languages: ['it-IT', 'it', 'en'],
        timeZone: 'Europe/Rome',
      },
      // 葡萄牙语
      {
        locale: 'pt-BR',
        languages: ['pt-BR', 'pt', 'en'],
        timeZone: 'America/Sao_Paulo',
      },
      {
        locale: 'pt-PT',
        languages: ['pt-PT', 'pt', 'en'],
        timeZone: 'Europe/Lisbon',
      },
      // 俄语
      {
        locale: 'ru-RU',
        languages: ['ru-RU', 'ru', 'en'],
        timeZone: 'Europe/Moscow',
      },
      // 阿拉伯语
      {
        locale: 'ar-SA',
        languages: ['ar-SA', 'ar', 'en'],
        timeZone: 'Asia/Riyadh',
      },
      // 印地语
      {
        locale: 'hi-IN',
        languages: ['hi-IN', 'hi', 'en'],
        timeZone: 'Asia/Kolkata',
      },
      // 泰语
      {
        locale: 'th-TH',
        languages: ['th-TH', 'th', 'en'],
        timeZone: 'Asia/Bangkok',
      },
      // 越南语
      {
        locale: 'vi-VN',
        languages: ['vi-VN', 'vi', 'en'],
        timeZone: 'Asia/Ho_Chi_Minh',
      },
      // 印尼语
      {
        locale: 'id-ID',
        languages: ['id-ID', 'id', 'en'],
        timeZone: 'Asia/Jakarta',
      },
      // 土耳其语
      {
        locale: 'tr-TR',
        languages: ['tr-TR', 'tr', 'en'],
        timeZone: 'Europe/Istanbul',
      },
      // 波兰语
      {
        locale: 'pl-PL',
        languages: ['pl-PL', 'pl', 'en'],
        timeZone: 'Europe/Warsaw',
      },
      // 荷兰语
      {
        locale: 'nl-NL',
        languages: ['nl-NL', 'nl', 'en'],
        timeZone: 'Europe/Amsterdam',
      },
      // 瑞典语
      {
        locale: 'sv-SE',
        languages: ['sv-SE', 'sv', 'en'],
        timeZone: 'Europe/Stockholm',
      },
    ]
  }

  /**
   * 随机获取一个浏览器 locale 配置
   */
  static getRandomLocale(): BrowserLocaleConfig {
    const locales = this.getCommonBrowserLocales()
    return locales[Math.floor(Math.random() * locales.length)]
  }

  /**
   * 根据地区代码获取 locale 配置
   */
  static getLocaleByRegion(region: string): BrowserLocaleConfig | undefined {
    const regionUpper = region.toUpperCase()
    return this.getCommonBrowserLocales().find(config =>
      config.locale.toUpperCase().endsWith(regionUpper),
    )
  }

  /**
   * 根据语言代码获取 locale 配置列表
   */
  static getLocalesByLanguage(language: string): BrowserLocaleConfig[] {
    const langLower = language.toLowerCase()
    return this.getCommonBrowserLocales().filter(config =>
      config.locale.toLowerCase().startsWith(langLower),
    )
  }

  /**
   * 生成完整的浏览器 locale 模拟数据
   * 适用于 Playwright/Puppeteer 的 locale 和 timezoneId 设置
   */
  static generateBrowserLocaleData(locale?: string): {
    locale: string
    timezoneId: string
    languages: string[]
    localeInfo: LocaleInfo
  } {
    const config = locale
      ? this.getCommonBrowserLocales().find(c => c.locale === locale) || this.getRandomLocale()
      : this.getRandomLocale()

    return {
      locale: config.locale,
      timezoneId: config.timeZone,
      languages: config.languages,
      localeInfo: this.getLocaleInfo(config.locale),
    }
  }

  /**
   * 获取所有支持的时区列表
   */
  static getAllTimeZones(): string[] {
    // 常用时区列表
    return [
      // 美洲
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Anchorage',
      'America/Phoenix',
      'America/Toronto',
      'America/Vancouver',
      'America/Mexico_City',
      'America/Sao_Paulo',
      'America/Buenos_Aires',
      'America/Santiago',
      'America/Lima',
      'America/Bogota',
      'America/Caracas',
      // 欧洲
      'Europe/London',
      'Europe/Paris',
      'Europe/Berlin',
      'Europe/Rome',
      'Europe/Madrid',
      'Europe/Amsterdam',
      'Europe/Brussels',
      'Europe/Vienna',
      'Europe/Stockholm',
      'Europe/Copenhagen',
      'Europe/Oslo',
      'Europe/Helsinki',
      'Europe/Warsaw',
      'Europe/Prague',
      'Europe/Budapest',
      'Europe/Bucharest',
      'Europe/Athens',
      'Europe/Istanbul',
      'Europe/Moscow',
      'Europe/Kiev',
      'Europe/Lisbon',
      'Europe/Dublin',
      'Europe/Zurich',
      // 亚洲
      'Asia/Shanghai',
      'Asia/Hong_Kong',
      'Asia/Taipei',
      'Asia/Tokyo',
      'Asia/Seoul',
      'Asia/Singapore',
      'Asia/Bangkok',
      'Asia/Ho_Chi_Minh',
      'Asia/Jakarta',
      'Asia/Manila',
      'Asia/Kuala_Lumpur',
      'Asia/Dubai',
      'Asia/Riyadh',
      'Asia/Kolkata',
      'Asia/Karachi',
      'Asia/Dhaka',
      'Asia/Colombo',
      'Asia/Kathmandu',
      'Asia/Tehran',
      'Asia/Baghdad',
      'Asia/Jerusalem',
      // 大洋洲
      'Australia/Sydney',
      'Australia/Melbourne',
      'Australia/Brisbane',
      'Australia/Perth',
      'Australia/Adelaide',
      'Pacific/Auckland',
      'Pacific/Fiji',
      'Pacific/Honolulu',
      // 非洲
      'Africa/Cairo',
      'Africa/Lagos',
      'Africa/Johannesburg',
      'Africa/Nairobi',
      'Africa/Casablanca',
      'Africa/Algiers',
    ]
  }
}

export function generateRandomLocale() {
  return BrowserLocaleGenerator.getRandomLocale().locale
}
