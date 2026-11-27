/**
 * 全站页面可达链（E4 的第一批 pages 用例）。
 *
 * 覆盖调研报告（`.tmp-e2e-research/coverage-gap-matrix.md` §1.1）的**侧边栏业务页全集**
 * （页码不写死：新增业务页按同一判据补进对应链）：
 * 之前的 E2E 只在浏览器里真正断言过 `/home` 与 `/system/device`，其余页面（含 `/me` 之外的
 * 所有 system / app 模块）的 DOM 从未被打开过。admin 的路由是**库里的菜单**经
 * `buildRoutes()` 在运行期把 `component` 字段解析成 `import.meta.glob` 里的异步组件 ——
 * 「菜单指向不存在的组件」没有任何静态校验，只有真实导航能证伪（已有一例真漂移：
 * `/demo/table/base` → `demo/table/baseTable`，见文件末尾的 fixme）。
 *
 * 每页的断言分三层：
 * 1. **路由可达**：URL 落在菜单拼出的真实 path，没有被 `beforeEach` 的权限兜底踢到
 *    `/missing-permissions`、`/auth` 或 404；
 * 2. **组件挂载**：布局内容容器（`#<route.name>-content`，由 `layout/default/scrollContent.vue`
 *    按当前路由名生成）出现元素子节点 —— 空组件路由只会留下注释节点。这一层也是 fixme 用例
 *    用来钉住「组件解析失败」的判据；
 * 3. **首屏主数据**：页面挂载时自己发出的列表 / 树 / 监控请求逐条等 `code === 20000`
 *    （业务错误也是 HTTP 200，所以只认业务码）。纯静态页（home / dashboard）没有主数据请求，
 *    由第 1、2 层兜底；about 的 `/deps`、monitor/server 的 8 个只读面板都按真实端点断言。
 *
 * 登录只做**一次**：整个文件是一个 Playwright worker，`authedPage` 是 worker 级共享只读
 * context（tests/fixtures.ts），页与页之间用 `navigateInApp` 做应用内跳转 —— 不整页 reload、
 * 不重新登录（不变量 7：auth.setup 不产出 storageState）。
 *
 * 分组依据是路由结构：静态入口 / system 用户域 / system 字典与国际化 / system 设备与审计 /
 * app 域 / demo 抽样。一条用例串多页，逐页 `test.step`，失败消息点名页面与缺失的响应。
 */
import type { Page } from '@playwright/test'
import {
  AppRoutes,
  SystemEndpointRoutes,
  SystemRoutes,
  WalnutAdminConstAppResponseCode,
} from '../../lib/protocol/contract.ts'
import {
  captureEnvelopes,
  expectSidebarRendered,
  navigateToRoute,
  waitForEnvelope,
} from '../../lib/ui.ts'
import { expect, test } from '../fixtures.ts'

const SUCCESS = WalnutAdminConstAppResponseCode.SUCCESS

/** 路由解析 / 组件挂载的等待上限：菜单路由都是本地异步 chunk，15s 足够慢环境加载 */
const ROUTE_TIMEOUT_MS = 15_000
/** 首屏请求的单条等待上限（monitor/server 的 8 个面板并行发出，先到的先命中） */
const ENVELOPE_TIMEOUT_MS = 15_000

interface PageDefinition {
  /** 菜单拼出的真实 URL */
  path: string
  /** seed 菜单的 name（布局内容容器 id = `${name}-content`） */
  routeName: string
  /** 页面挂载时必然发出的主数据请求（完整 URL 后缀）；纯静态页缺省 */
  envelopes?: string[]
  /** 已落地的表格 testid（E1 产出：user / role / deleted 三张表） */
  tableTestId?: string
}

/** 一条用例共用的响应采集（`captureEnvelopes` 的可读数组 + 停止函数） */
type PageCapture = ReturnType<typeof captureEnvelopes>

/**
 * 访问一页并逐层断言。
 *
 * `captured` 是整条用例共用的采集对象，`fromIndex` 只匹配本次导航之后到达的响应 ——
 * 同一 URL 的旧响应（例如启动时的同源请求）不会被误当成本页的证据。
 */
async function visitPage(
  page: Page,
  captured: PageCapture,
  definition: PageDefinition,
): Promise<void> {
  await test.step(definition.path, async () => {
    const fromIndex = captured.entries.length

    await navigateToRoute(page, definition.path, definition.routeName)

    // 组件挂载：空组件路由（菜单 component 解析成 undefined）没有元素子节点。
    await expect(
      page.locator(`#${definition.routeName}-content > *`).first(),
      `${definition.path} 的内容容器 #${definition.routeName}-content 没有挂载任何组件` +
        '（菜单 component 指向的 .vue 不存在？）',
    ).toBeVisible({ timeout: ROUTE_TIMEOUT_MS })

    for (const suffix of definition.envelopes ?? []) {
      await waitForEnvelope(
        captured.entries,
        (entry) => entry.url.endsWith(suffix) && entry.code === SUCCESS,
        ENVELOPE_TIMEOUT_MS,
        fromIndex,
      )
    }

    if (definition.tableTestId !== undefined) {
      await expect(
        page.getByTestId(definition.tableTestId),
        `${definition.path} 的表格容器 ${definition.tableTestId} 不可见`,
      ).toBeVisible({ timeout: ROUTE_TIMEOUT_MS })
    }

    // 首屏请求期间若权限守卫把页面踢走，URL 断言在这里收口（不只看刚导航完的一瞬）
    expect(new URL(page.url()).pathname, `${definition.path} 在首屏请求期间被重定向`).toBe(
      definition.path,
    )
  })
}

/** 一条用例的前置：新页面从 worker 登录态启动 → 应用外壳出现（动态路由已生成） */
async function openAuthedPage(page: Page): Promise<PageCapture> {
  const captured = captureEnvelopes(page)
  await page.goto('/')
  await expectSidebarRendered(page)
  return captured
}

test.describe('全站页面可达链', { tag: '@pages' }, () => {
  test('静态入口：/home → /dashboard → /about（about 首屏 /deps 20000）', async ({
    authedPage,
  }) => {
    const captured = await openAuthedPage(authedPage)

    try {
      await visitPage(authedPage, captured, { path: '/home', routeName: 'Homepage' })
      await visitPage(authedPage, captured, { path: '/dashboard', routeName: 'Dashboard' })
      await visitPage(authedPage, captured, {
        path: '/about',
        routeName: 'About',
        envelopes: [AppRoutes.DEPS],
      })
    } finally {
      captured.stop()
    }
  })

  test('system 用户域：/system/user → /system/role → /system/menu', async ({ authedPage }) => {
    const captured = await openAuthedPage(authedPage)

    try {
      await visitPage(authedPage, captured, {
        path: '/system/user',
        routeName: 'User',
        envelopes: [`${SystemRoutes.USER}/list`],
        tableTestId: 'user-list-table',
      })
      await visitPage(authedPage, captured, {
        path: '/system/role',
        routeName: 'Role',
        envelopes: [`${SystemRoutes.ROLE}/list`],
        tableTestId: 'role-list-table',
      })
      await visitPage(authedPage, captured, {
        path: '/system/menu',
        routeName: 'Menu',
        envelopes: [SystemEndpointRoutes.MENU_TREE],
      })
    } finally {
      captured.stop()
    }
  })

  test('system 字典与国际化：/system/dict → /system/lang → /system/locale', async ({
    authedPage,
  }) => {
    const captured = await openAuthedPage(authedPage)

    try {
      await visitPage(authedPage, captured, {
        path: '/system/dict',
        routeName: 'Dict',
        envelopes: [`${SystemRoutes.DICT_TYPE}/list`],
      })
      await visitPage(authedPage, captured, {
        path: '/system/lang',
        routeName: 'Lang',
        envelopes: [`${SystemRoutes.LANG}/list`],
      })
      await visitPage(authedPage, captured, {
        path: '/system/locale',
        routeName: 'Locale',
        envelopes: [`${SystemRoutes.LOCALE}/list`],
      })
    } finally {
      captured.stop()
    }
  })

  test('system 设备与审计：/system/device → /system/deleted → /system/log/auth → /system/log/operate', async ({
    authedPage,
  }) => {
    const captured = await openAuthedPage(authedPage)

    try {
      await visitPage(authedPage, captured, {
        path: '/system/device',
        routeName: 'Device',
        envelopes: [`${SystemRoutes.DEVICE}/list`],
      })
      await visitPage(authedPage, captured, {
        path: '/system/deleted',
        routeName: 'Deleted',
        envelopes: [`${SystemRoutes.DELETED}/list`],
        tableTestId: 'deleted-list-table',
      })
      await visitPage(authedPage, captured, {
        path: '/system/log/auth',
        routeName: 'LogAuth',
        envelopes: [`${SystemRoutes.LOG_AUTH}/list`],
      })
      await visitPage(authedPage, captured, {
        path: '/system/log/operate',
        routeName: 'LogOperate',
        envelopes: [`${SystemRoutes.LOG_OPERATE}/list`],
      })
    } finally {
      captured.stop()
    }
  })

  test('app 域：/app/setting → /app/logger → /app/monitor/cache → /app/monitor/user → /app/monitor/server', async ({
    authedPage,
  }) => {
    const captured = await openAuthedPage(authedPage)

    try {
      await visitPage(authedPage, captured, {
        path: '/app/setting',
        routeName: 'AppSetting',
        envelopes: [`${AppRoutes.SETTING}/list`],
      })
      await visitPage(authedPage, captured, {
        path: '/app/logger',
        routeName: 'AppLogger',
        envelopes: [`${AppRoutes.LOGGER}/list`],
      })
      await visitPage(authedPage, captured, {
        path: '/app/monitor/cache',
        routeName: 'AppMonitorCache',
        envelopes: [`${AppRoutes.MONITOR_CACHE}/list`],
      })
      await visitPage(authedPage, captured, {
        path: '/app/monitor/user',
        routeName: 'AppMonitorUser',
        envelopes: [`${AppRoutes.MONITOR_USER}/list`],
      })
      // 服务器监控没有列表：8 个只读面板各发一条 GET，主数据就是这 8 条
      await visitPage(authedPage, captured, {
        path: '/app/monitor/server',
        routeName: 'AppMonitorServer',
        envelopes: [
          AppRoutes.MONITOR_SERVER_CPU,
          AppRoutes.MONITOR_SERVER_MEM,
          AppRoutes.MONITOR_SERVER_OS,
          AppRoutes.MONITOR_SERVER_SYS,
          AppRoutes.MONITOR_SERVER_DISK,
          AppRoutes.MONITOR_SERVER_BATTERY,
          AppRoutes.MONITOR_SERVER_TIME,
          AppRoutes.MONITOR_SERVER_NETWORK,
        ],
      })
    } finally {
      captured.stop()
    }
  })

  /**
   * demo 抽样（3 页，来自三个不同的 demo 组）：不重复 demo 的组件 showcase，
   * 只证明「菜单 → 组件 → 挂载」这条解析链对演示页同样成立。
   */
  test('demo 抽样：/demo/table/hook → /demo/form → /demo/vendor/echarts', async ({
    authedPage,
  }) => {
    const captured = await openAuthedPage(authedPage)

    try {
      await visitPage(authedPage, captured, { path: '/demo/table/hook', routeName: 'UseTableDemo' })
      await visitPage(authedPage, captured, { path: '/demo/form', routeName: 'DemoForm' })
      await visitPage(authedPage, captured, {
        path: '/demo/vendor/echarts',
        routeName: 'EChartsDemo',
      })
    } finally {
      captured.stop()
    }
  })

  /**
   * 已知 seed 漂移（调研报告 §1.1 的「一处真实的数据漂移」）：
   *
   * - seed 菜单 `/demo/table/base` 的 `component = demo/table/baseTable`；
   * - `apps/admin/src/views/demo/table/` 下只有 `index.vue` 与 `useTable.vue` ——
   *   `resolveViewModules()` 返回 `undefined`，路由存在但内容是空的；
   * - git 历史里从未有过 `baseTable.vue`（`git log --all -S baseTable` 只命中 seed 提交），
   *   seed 来自上游 Mongo 数据，语义（该指向 `useTable` 还是 `index`）无法从仓库内确定。
   *
   * 处置：不擅自改 seed（那是产品数据）；用 `test.fixme` 留下可执行的复现 —— 别人补上组件
   * 或修正 seed 后，删掉 `.fixme` 就是一条正常回归。通用判据（内容容器有元素子节点）与
   * 上面 18 页完全一致。
   */
  test.fixme('demo/table/base：菜单指向不存在的组件（已知 seed 漂移，待定语义）', async ({
    authedPage,
  }) => {
    const captured = captureEnvelopes(authedPage)
    await authedPage.goto('/')
    await expectSidebarRendered(authedPage)

    await navigateToRoute(authedPage, '/demo/table/base', 'BaseTable')
    await expect(
      authedPage.locator('#BaseTable-content > *').first(),
      'demo/table/baseTable 组件不存在：菜单是「空组件路由」',
    ).toBeVisible({ timeout: ROUTE_TIMEOUT_MS })
    captured.stop()
  })
})
