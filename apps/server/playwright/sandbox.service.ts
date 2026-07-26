import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { Browser, BrowserContext, chromium, Page } from 'playwright'

export interface SandboxConfig {
  id: number
  proxy?: {
    server: string
    username?: string
    password?: string
  }
  userAgent: string
  locale: string
  timezone: string
  viewport: {
    width: number
    height: number
  }
  geolocation?: {
    latitude: number
    longitude: number
  }
  permissions?: string[]
}

export interface SandboxInstance {
  id: number
  browser: Browser
  context: BrowserContext
  page: Page
  config: SandboxConfig
}

@Injectable()
export class PlaywrightSandboxService implements OnModuleDestroy {
  private sandboxes: SandboxInstance[] = []

  /**
   * 创建多个沙盒环境
   */
  async createSandboxes(configs: SandboxConfig[]): Promise<SandboxInstance[]> {
    const instances: SandboxInstance[] = []

    for (const config of configs) {
      const instance = await this.createSingleSandbox(config)
      instances.push(instance)
      this.sandboxes.push(instance)
    }

    return instances
  }

  /**
   * 创建单个沙盒环境
   */
  private async createSingleSandbox(config: SandboxConfig): Promise<SandboxInstance> {
  // 启动独立的浏览器实例
    const browser = await chromium.launch({
      headless: false, // 设置为 true 可以无头模式运行
      args: [
        // // 安全沙箱相关
        // '--no-sandbox', // 禁用沙箱模式（在 Docker/CI 环境中常用，但会降低安全性）
        // '--disable-setuid-sandbox', // 禁用 setuid 沙箱（Linux 特定，配合 --no-sandbox 使用）

        '--auto-open-devtools-for-tabs', // 自动打开开发者工具

        // 性能优化
        '--disable-dev-shm-usage', // 禁用 /dev/shm 共享内存使用，改用 /tmp（防止 Docker 环境内存不足崩溃）

        // 反爬虫/反检测
        '--disable-blink-features=AutomationControlled', // 隐藏 navigator.webdriver 标志，使浏览器看起来像普通用户操作
      ],
    })

    // 创建浏览器上下文(完全隔离的环境)
    const context = await browser.newContext({
      // 代理配置
      proxy: config.proxy,

      // User Agent
      userAgent: config.userAgent,

      // 语言和地区
      locale: config.locale,
      timezoneId: config.timezone,

      // 视口大小
      viewport: config.viewport,

      // 地理位置
      geolocation: config.geolocation,
      permissions: config.permissions || [],

      // sw暂时block
      serviceWorkers: 'block',

      // 其他反检测配置
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,

      // 额外的 HTTP 头
      extraHTTPHeaders: {
        'Accept-Language': config.locale || 'en-US,en;q=0.9',
      },
    })

    // 注入反检测脚本
    await context.addInitScript(() => {
      // 覆盖 navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      })

      // 覆盖 plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      })

      // 覆盖 languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      // Chrome 特征
      (window as any).chrome = {
        runtime: {},
      }

      // Permissions
      const originalQuery = window.navigator.permissions.query
      window.navigator.permissions.query = async (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
          : originalQuery(parameters)
    })

    // 创建新页面
    const page = await context.newPage()

    return {
      id: config.id,
      browser,
      context,
      page,
      config,
    }
  }

  /**
   * 打开指定 URL(所有沙盒或指定沙盒)
   */
  async navigateAll(url: string, sandboxIds?: number[]): Promise<void> {
    const targetSandboxes = sandboxIds
      ? this.sandboxes.filter(s => sandboxIds.includes(s.id))
      : this.sandboxes

    await Promise.all(
      targetSandboxes.map(async sandbox => sandbox.page.goto(url, { waitUntil: 'networkidle' })),
    )
  }

  /**
   * 关闭指定沙盒
   */
  async closeSandbox(sandboxId: number): Promise<void> {
    const index = this.sandboxes.findIndex(s => s.id === sandboxId)
    if (index !== -1) {
      const sandbox = this.sandboxes[index]
      await sandbox.context.close()
      await sandbox.browser.close()
      this.sandboxes.splice(index, 1)
    }
  }

  /**
   * 关闭所有沙盒
   */
  async closeAll(): Promise<void> {
    await Promise.all(
      this.sandboxes.map(async (sandbox) => {
        await sandbox.context.close()
        await sandbox.browser.close()
      }),
    )
    this.sandboxes = []
  }

  /**
   * 获取所有沙盒实例
   */
  getSandboxes(): SandboxInstance[] {
    return this.sandboxes
  }

  /**
   * 获取指定沙盒
   */
  getSandbox(sandboxId: number): SandboxInstance | undefined {
    return this.sandboxes.find(s => s.id === sandboxId)
  }

  /**
   * 模块销毁时清理资源
   */
  async onModuleDestroy() {
    await this.closeAll()
  }
}
