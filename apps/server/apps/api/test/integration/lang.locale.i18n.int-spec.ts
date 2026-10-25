import type { INestApplication } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SysLangEntity } from '@/modules/system/lang/entity/lang.entity'
import { SysLangService } from '@/modules/system/lang/lang.service'
import { SysLangRepoService } from '@/modules/system/lang/repo/lang.repo.service'
import { SysLocaleEntity } from '@/modules/system/locale/entity/locale.entity'
import { SysLocaleService } from '@/modules/system/locale/locale.service'
import { SysLocaleSharedService } from '@/modules/system/locale/shared/locale.shared.service'
import { createIntegrationApp, getWalnutPgDataSource } from './helpers/create-integration-app'
import { INTEGRATION_DATABASE_NAME } from './helpers/integration.const'

/**
 * B2 i18n 聚合 SQL 重写的对账基准（phase2 5.2 / phase3-plan §1 B2）。
 *
 * lang.repo.service 的两条 Mongo 聚合管道迁 PG 后，输出形态必须与 Mongo 版逐字段一致
 * （消费方是 admin 启动时的 locale message 拉取，接口形态不能变）：
 *
 * - findByIdWithLocaleCounts：双 $lookup + $size 计数 → 相关子查询计数（含 value IS NOT
 *   NULL 的 finished 口径）；查无此 lang 返回 undefined 与 Mongo 版 res[0] 一致。
 * - findMessagesByLang：$arrayToObject 动态消息 map → jsonb_object_agg —— value 为 null
 *   的条目产出 `"key": null`（双方一致）；无匹配语言时 Mongo 版 res[0] 为 undefined
 *   （上层 `.data` 即炸），PG 版 COALESCE 兜底为 `{ data: {} }` —— 本套用例按 PG 版
 *   兜底口径断言（phase2 5.2 定案）。
 * - 顺带覆盖 lang list（process = finished/total*100）、locale list 分组聚合
 *（value 模糊 / langId 缺翻译过滤 / 公共 key 过滤）与 locale message 全链路。
 */
describe('B2 lang/locale i18n aggregation rewrite (on real PG)', () => {
  let app: INestApplication
  let pgDataSource: DataSource
  let langRepoService: SysLangRepoService
  let langService: SysLangService
  let localeService: SysLocaleService
  let localeSharedService: SysLocaleSharedService

  const LANG_PREFIX = 'b2int_'

  function uniqueLangName() {
    return `${LANG_PREFIX}${randomUUID().replaceAll('-', '').slice(0, 8)}`
  }

  function uniqueLocaleKey() {
    return `b2int.key.${randomUUID().replaceAll('-', '').slice(0, 8)}`
  }

  /**
   * 直插 lang + locale 行（FK：locale.lang_id → sys_lang，先 lang 后 locale，
   * 与业务写入路径同序）。value: null 即「未翻译」。
   */
  async function createLangWithLocales(options: {
    lang?: string
    status?: boolean
    locales: Array<{ key: string, value: string | null }>
  }) {
    const langRepo = pgDataSource.getRepository(SysLangEntity)
    const lang = await langRepo.save(langRepo.create({
      lang: options.lang ?? uniqueLangName(),
      description: `int-spec ${Date.now()}`,
      order: 1,
      status: options.status ?? true,
    }))

    if (options.locales.length > 0) {
      const localeRepo = pgDataSource.getRepository(SysLocaleEntity)
      await localeRepo.save(options.locales.map(locale => localeRepo.create({
        langId: lang.id,
        key: locale.key,
        value: locale.value,
      })))
    }

    return lang
  }

  beforeAll(async () => {
    app = await createIntegrationApp()
    pgDataSource = getWalnutPgDataSource(app)
    langRepoService = app.get(SysLangRepoService)
    langService = app.get(SysLangService)
    localeService = app.get(SysLocaleService)
    localeSharedService = app.get(SysLocaleSharedService)

    expect(pgDataSource.options.database).toBe(INTEGRATION_DATABASE_NAME)
  })

  afterAll(async () => {
    // lang 删除经 FK CASCADE 连带清掉 locale 行，不污染同批其他用例
    await pgDataSource
      .getRepository(SysLangEntity)
      .createQueryBuilder()
      .delete()
      .where('lang LIKE :prefix', { prefix: `${LANG_PREFIX}%` })
      .execute()

    await app.close()
  })

  it('findByIdWithLocaleCounts：total / finished 计数口径与 Mongo 版一致（finished 排除 value=null）', async () => {
    const key1 = uniqueLocaleKey()
    const key2 = uniqueLocaleKey()
    const lang = await createLangWithLocales({
      locales: [
        { key: key1, value: 'v1' },
        { key: key2, value: null },
      ],
    })

    const result = await langRepoService.findByIdWithLocaleCounts(lang.id)

    expect(result).toBeDefined()
    expect(result!.id).toBe(lang.id)
    expect(result!.lang).toBe(lang.lang)
    expect(result!.populated_localesTotalCount).toBe(2)
    expect(result!.populated_localesFinishedCount).toBe(1)
  })

  it('findByIdWithLocaleCounts：零 locale 的 lang 计数为 0/0；查无此 lang 返回 undefined', async () => {
    const emptyLang = await createLangWithLocales({ locales: [] })

    const empty = await langRepoService.findByIdWithLocaleCounts(emptyLang.id)
    expect(empty!.populated_localesTotalCount).toBe(0)
    expect(empty!.populated_localesFinishedCount).toBe(0)

    const missing = await langRepoService.findByIdWithLocaleCounts(randomUUID())
    expect(missing).toBeUndefined()
  })

  it('findMessagesByLang：消息 map 输出形态与 Mongo 版逐字段一致（缺失翻译产出 "key": null）', async () => {
    const key1 = uniqueLocaleKey()
    const key2 = uniqueLocaleKey()
    const key3 = uniqueLocaleKey()
    const lang = await createLangWithLocales({
      locales: [
        { key: key1, value: 'value one' },
        { key: key2, value: null },
        { key: key3, value: 'value three' },
      ],
    })

    const result = await langRepoService.findMessagesByLang(lang.lang as never)

    // $arrayToObject / jsonb_object_agg 的逐字段对账：null 保留、键集合一致
    expect(result).toEqual({
      data: {
        [key1]: 'value one',
        [key2]: null,
        [key3]: 'value three',
      },
    })
  })

  it('findMessagesByLang：无 locale 的 lang 兜底为空 map（{ data: {} }，phase2 5.2 定案）', async () => {
    const emptyLang = await createLangWithLocales({ locales: [] })

    const result = await langRepoService.findMessagesByLang(emptyLang.lang as never)

    expect(result).toEqual({ data: {} })
  })

  it('findPublic：只出启用语言，投影键恰为 order / lang / description（无 id、无时间戳）', async () => {
    const disabled = await createLangWithLocales({ status: false, locales: [] })

    const result = await langRepoService.findPublic()

    const disabledRow = result.find(row => row.lang === disabled.lang)
    expect(disabledRow).toBeUndefined()

    const ownRows = result.filter(row => row.lang.startsWith(LANG_PREFIX))
    expect(ownRows.length).toBeGreaterThan(0)
    for (const row of ownRows) {
      expect(Object.keys(row).sort()).toEqual(['description', 'lang', 'order'])
    }
  })

  it('lang list：行附 locale 计数与 process（finished/total*100），total 只含过滤后行', async () => {
    const finishedKey = uniqueLocaleKey()
    const pendingKey = uniqueLocaleKey()
    const lang = await createLangWithLocales({
      locales: [
        { key: finishedKey, value: 'done' },
        { key: pendingKey, value: null },
      ],
    })

    const result = await langService.list({
      query: { lang: lang.lang },
      page: { page: 1, pageSize: 10 },
    } as never)

    expect(result.total).toBe(1)
    expect(result.data).toHaveLength(1)

    const row = result.data[0] as never as Record<string, unknown>
    expect(row.id).toBe(lang.id)
    expect(row.populated_localesTotalCount).toBe(2)
    expect(row.populated_localesFinishedCount).toBe(1)
    expect(row.process).toBe(50)
  })

  it('locale list：按 key 分组出 process（finished/langs.length）、createdAt/updatedAt 取组内首条', async () => {
    const otherLang = await createLangWithLocales({ locales: [] })
    const lang = await createLangWithLocales({ locales: [] })

    const translatedKey = uniqueLocaleKey()
    const partialKey = uniqueLocaleKey()

    const localeRepo = pgDataSource.getRepository(SysLocaleEntity)
    // translatedKey 两语言全翻译 → finished=2；partialKey 仅一条 → finished=1
    await localeRepo.save([
      localeRepo.create({ langId: lang.id, key: translatedKey, value: 't-lang' }),
      localeRepo.create({ langId: otherLang.id, key: translatedKey, value: 't-other' }),
      localeRepo.create({ langId: lang.id, key: partialKey, value: 'partial-lang' }),
      localeRepo.create({ langId: otherLang.id, key: partialKey, value: null }),
    ])

    // process 分母 = 全库语言总数（langRepoService.findAll 行数），测试库随用例累积
    const langsCount = (await langRepoService.findAll()).length

    const result = await localeService.list({
      query: { key: partialKey.slice(0, 20) },
      page: { page: 1, pageSize: 10 },
    } as never)

    expect(result.total).toBe(1)
    const row = result.data[0] as never as Record<string, unknown>
    expect(row.key).toBe(partialKey)
    // Mongo 版 _id = 分组键；PG 响应契约（B1 模板）改为 id，语义一致
    expect(row.id).toBe(partialKey)
    expect(row.process).toBeCloseTo(1 / langsCount)
    expect(row.createdAt).toBeInstanceOf(Date)
    expect(row.updatedAt).toBeInstanceOf(Date)
  })

  it('locale list：value 模糊是文档级过滤（未命中的 key 整组消失，process 分子不受影响）', async () => {
    const lang = await createLangWithLocales({ locales: [] })
    const localeRepo = pgDataSource.getRepository(SysLocaleEntity)

    const hitKey = uniqueLocaleKey()
    const missKey = uniqueLocaleKey()
    await localeRepo.save([
      localeRepo.create({ langId: lang.id, key: hitKey, value: 'the needle here' }),
      localeRepo.create({ langId: lang.id, key: missKey, value: 'nothing to see' }),
    ])

    const result = await localeService.list({
      query: { value: 'needle' },
      page: { page: 1, pageSize: 10 },
    } as never)

    expect(result.total).toBe(1)
    const row = result.data[0] as never as Record<string, unknown>
    expect(row.key).toBe(hitKey)
    // finished 在文档级过滤之前计好（Mongo $group 在前）：该 key 单语言 finished=1，
    // process = finished / 全库语言总数（见上一用例的分母口径）
    const langsCount = (await langRepoService.findAll()).length
    expect(row.process).toBeCloseTo(1 / langsCount)
  })

  it('locale list：langId 过滤 = 找该语言的缺翻译 key（docs.langId 等值 + docs.value IS NULL）', async () => {
    const lang = await createLangWithLocales({ locales: [] })
    const otherLang = await createLangWithLocales({ locales: [] })
    const localeRepo = pgDataSource.getRepository(SysLocaleEntity)

    const missingKey = uniqueLocaleKey()
    const translatedKey = uniqueLocaleKey()
    await localeRepo.save([
      // lang 自己两个 key 都翻译了；otherLang 只翻译了 translatedKey
      localeRepo.create({ langId: lang.id, key: missingKey, value: 'translated' }),
      localeRepo.create({ langId: lang.id, key: translatedKey, value: 'translated' }),
      localeRepo.create({ langId: otherLang.id, key: translatedKey, value: 'translated' }),
      localeRepo.create({ langId: otherLang.id, key: missingKey, value: null }),
    ])

    const result = await localeService.list({
      query: { langId: otherLang.id },
      page: { page: 1, pageSize: 10 },
    } as never)

    expect(result.total).toBe(1)
    const row = result.data[0] as never as Record<string, unknown>
    expect(row.key).toBe(missingKey)
  })

  it('locale read：出参 { [langId]: value, key }，langId 即 uuid（原 ObjectId.toString() 语义）', async () => {
    const key = uniqueLocaleKey()
    const lang = await createLangWithLocales({
      locales: [{ key, value: 'read-value' }],
    })

    const result = await localeService.read(key)

    expect(result).toEqual({
      [lang.id]: 'read-value',
      key,
    })
  })

  it('locale message 全链路：getLocaleMessage 返回扁平消息 map（admin 启动拉取的消费形态）', async () => {
    const key1 = uniqueLocaleKey()
    const key2 = uniqueLocaleKey()
    const lang = await createLangWithLocales({
      locales: [
        { key: key1, value: 'msg one' },
        { key: key2, value: null },
      ],
    })

    const result = await localeSharedService.getLocaleMessage(lang.lang as never, false)

    expect(result).toEqual({
      [key1]: 'msg one',
      [key2]: null,
    })
  })
})
