/**
 * `.vscode/settings-dev.schema.json` 的生成器（喂编辑器提示，不参与运行时）。
 *
 * **2026-11-28 换实现**：原先走 `ts-json-schema-generator` 的 classic 编译器 API
 * （`TJS.createGenerator(config).createSchema(type)`）。批次 8（P5c）把 `typescript` 包面换成
 * TNB（typescript-native-bridge）之后，它在 **project mode** 下拿到的 Program 是空壳 ——
 * `getSourceFiles()` 里的文件没有语句，于是抛 `RootlessError: No root type "IStoreSetting.Dev"
 * found`，`predev` / `prebuild` / `pretypes:check` 三条链一起断（TNB 的缺陷在桥接层修，别在这里等）。
 * 现在改为 `tsrs/sync`（TS 7.1 形状的 JS API，catalog 锁 `7.1.0-beta.tsrs5`）的 checker 直接读类型图，
 * 手写这一份 draft-07 文档；产物**必须逐字节不变**（与 `HEAD:.vscode/settings-dev.schema.json`
 * 的 15517 字节 blob 对齐）—— 换生成器不该让 diff 里出现任何 schema 变化。
 *
 * 代码里几处「为什么不直觉」的地方（union 字面量取声明序、boolean 折叠成 `type: 'boolean'`、
 * `@description` 走 `getJsDocTags()`）都是为了对齐上面那份基线，改之前先跟 blob 比一遍。
 */

import type { Checker, Project, Symbol as TsSymbol, Type, UnionType } from 'tsrs/sync'
import { resolve } from 'node:path'
import process from 'node:process'
import { BuildUtilsWriteFile } from '@walnut/vite-config/utils'
import {
  isIndexedAccessTypeNode,
  isLiteralTypeNode,
  isNumericLiteral,
  isStringLiteral,
  isTypeAliasDeclaration,
  isUnionTypeNode,
  SyntaxKind,
} from 'tsrs/ast'
import { API, SymbolFlags, TypeFlags } from 'tsrs/sync'
import {
  AppSettingsDevInterfaceFilePath,
  AppSettingsDevJSONSchemaFilePath,
} from '../utils/paths.ts'

const SCHEMA_TYPE = 'IStoreSetting.Dev'
const DRAFT_07 = 'http://json-schema.org/draft-07/schema#'

type JsonSchema = Record<string, unknown>

const isTagText = (tag: { text?: string }) => tag.text ?? ''

/** ts-json-schema-generator's post-processing of getDocumentationComment(). */
function normalizeDocumentation(text: string): string {
  if (!text) return ''
  return text
    .replace(/\r/g, '')
    .trim()
    .replace(/(?<=[^\n])\n(?=[^\n*-])/g, ' ')
    .trim()
}

/** TJS uses json5; JSON.parse + raw-text fallback matches this schema's JSDoc. */
function parseAnnotationValue(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const TEXT_TAGS = new Set([
  'title',
  'description',
  'format',
  'pattern',
  'contentMediaType',
  'contentEncoding',
  'discriminator',
])
const JSON_TAGS = new Set([
  'minimum',
  'exclusiveMinimum',
  'maximum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minProperties',
  'maxProperties',
  'minItems',
  'maxItems',
  'uniqueItems',
  'propertyNames',
  'contains',
  'const',
  'examples',
  'default',
  'required',
  'if',
  'then',
  'else',
  'readOnly',
  'writeOnly',
  'deprecated',
])

/** Mirrors ExtendedAnnotationsReader + BasicAnnotationsReader (subset). */
function readAnnotations(symbol: TsSymbol, checker: Checker): JsonSchema {
  const annotations: JsonSchema = {}
  const docs = normalizeDocumentation(symbol.getDocumentationComment(checker))
  if (docs) annotations.description = docs

  for (const tag of symbol.getJsDocTags(checker)) {
    const text = isTagText(tag)
    if (tag.name === 'example') {
      const parsed = parseAnnotationValue(text)
      annotations.examples = [...((annotations.examples as unknown[]) ?? []), parsed]
    } else if (TEXT_TAGS.has(tag.name)) {
      annotations[tag.name] = text
    } else if (JSON_TAGS.has(tag.name)) {
      annotations[tag.name] = parseAnnotationValue(text)
    }
  }
  return annotations
}

function isBooleanUnion(type: Type): boolean {
  if (!type.isUnionType()) return false
  const members = type.getTypes()
  if (members.length !== 2) return false
  const values = members.map((member) =>
    member.isBooleanLiteralType?.() ? member.value : undefined,
  )
  return values.includes(true) && values.includes(false)
}

function literalValue(type: Type): string | number | boolean | undefined {
  if (type.isStringLiteralType?.()) return type.value
  if (type.isNumberLiteralType?.()) return type.value
  if (type.isBooleanLiteralType?.()) return type.value
  return undefined
}

function enumTypeName(values: Array<string | number | boolean>): string | undefined {
  if (values.every((value) => typeof value === 'string')) return 'string'
  if (values.every((value) => typeof value === 'number')) return 'number'
  if (values.every((value) => typeof value === 'boolean')) return 'boolean'
  return undefined
}

/**
 * TJS reads literal-union order from syntax, so `(typeof C)[keyof typeof C]`
 * keeps declaration order. The checker sorts union members alphabetically;
 * recover source order from the alias declaration.
 */
function enumValuesFromAlias(
  alias: TsSymbol | undefined,
  checker: Checker,
  project: Project,
): Array<string | number | boolean> | undefined {
  const declaration = alias?.declarations?.[0]?.resolve(project)
  if (!declaration || !isTypeAliasDeclaration(declaration)) return undefined

  const typeNode = declaration.type
  if (isUnionTypeNode(typeNode)) {
    const values: Array<string | number | boolean> = []
    for (const member of typeNode.types) {
      if (!isLiteralTypeNode(member)) return undefined
      const literal = member.literal
      if (isStringLiteral(literal)) values.push(literal.text)
      else if (isNumericLiteral(literal)) values.push(Number(literal.text))
      else if (literal.kind === SyntaxKind.TrueKeyword) values.push(true)
      else if (literal.kind === SyntaxKind.FalseKeyword) values.push(false)
      else return undefined
    }
    return values
  }

  if (isIndexedAccessTypeNode(typeNode)) {
    // (typeof C)[keyof typeof C] — object properties keep declaration order.
    const objectType = checker.getTypeAtLocation(typeNode.objectType)
    const values = objectType
      .getProperties()
      .map((property) => literalValue(checker.getTypeOfSymbol(property)))
    if (values.length && values.every((value) => value !== undefined))
      return values as Array<string | number | boolean>
  }

  return undefined
}

function createGenerator(project: Project, rootName: string) {
  const checker = project.checker
  const definitions: Record<string, JsonSchema> = { [rootName]: {} }

  function buildAliasReference(type: Type): JsonSchema | undefined {
    const alias = type.getAliasSymbol?.()
    if (!alias?.name || alias.name === rootName) return undefined
    if (!(alias.name in definitions)) {
      definitions[alias.name] = {}
      definitions[alias.name] = buildCore(type, { skipAlias: true })
    }
    return { $ref: `#/definitions/${encodeURIComponent(alias.name)}` }
  }

  function buildUnion(type: UnionType): JsonSchema {
    if (isBooleanUnion(type)) return { type: 'boolean' }
    const values =
      enumValuesFromAlias(type.getAliasSymbol?.(), checker, project) ??
      type.getTypes().map((member) => literalValue(member))
    if (values.length && values.every((value) => value !== undefined)) {
      const name = enumTypeName(values as Array<string | number | boolean>)
      if (name) return { type: name, enum: values }
    }
    return { anyOf: type.getTypes().map((member) => buildCore(member)) }
  }

  function buildObject(type: Type): JsonSchema {
    const properties: Record<string, JsonSchema> = {}
    const required: string[] = []

    for (const property of type.getProperties()) {
      const propertySchema = buildCore(checker.getTypeOfSymbol(property))
      properties[property.name] = {
        ...propertySchema,
        ...readAnnotations(property, checker),
      }
      if (!(property.flags & SymbolFlags.Optional)) required.push(property.name)
    }

    const indexInfos = type.getIndexInfos()
    const additionalProperties = indexInfos.length ? buildCore(indexInfos[0].valueType) : false

    return {
      type: 'object',
      ...(Object.keys(properties).length ? { properties } : {}),
      ...(required.length ? { required } : {}),
      additionalProperties,
    }
  }

  function buildCore(type: Type, options: { skipAlias?: boolean } = {}): JsonSchema {
    if (!options.skipAlias) {
      const alias = buildAliasReference(type)
      if (alias) return alias
    }
    if (type.isUnionType()) return buildUnion(type)
    if (type.isStringLiteralType?.()) return { const: type.value, type: 'string' }
    if (type.isNumberLiteralType?.()) return { const: type.value, type: 'number' }
    if (type.isBooleanLiteralType?.()) return { const: type.value, type: 'boolean' }
    if (type.flags & TypeFlags.String) return { type: 'string' }
    if (type.flags & TypeFlags.Number) return { type: 'number' }
    if (type.flags & TypeFlags.Boolean) return { type: 'boolean' }
    if (type.flags & TypeFlags.Null) return { type: 'null' }
    if (type.flags & TypeFlags.Undefined) return { type: 'undefined' }
    if (type.flags & TypeFlags.Any || type.flags & TypeFlags.Unknown) return {}
    if (type.isObjectType()) return buildObject(type)
    throw new Error(`tsrs schema generator: unhandled type flags ${type.flags}`)
  }

  return { definitions, buildCore }
}

function resolveTypeSymbol(sourceSymbol: TsSymbol, segments: string[]): TsSymbol {
  let symbol = sourceSymbol
  for (const segment of segments) {
    const next = [...symbol.getExports().values()].find((exported) => exported.name === segment)
    if (!next) throw new Error(`tsrs schema generator: type segment not found: ${segment}`)
    symbol = next
  }
  return symbol
}

/** 生成 `.vscode/settings-dev.schema.json`（由 `build/generate/index.ts` 统一调用） */
export async function generateJSONSchemas(): Promise<void> {
  const cwd = process.cwd()
  const tsconfig = resolve(cwd, 'tsconfig.json')
  const sourcePath = resolve(cwd, AppSettingsDevInterfaceFilePath)

  const api = new API({ cwd })
  try {
    const snapshot = api.createSnapshot({ openProjects: [tsconfig] })
    const project = snapshot.getConfiguredProject(tsconfig)
    if (!project) throw new Error(`tsrs schema generator: could not open ${tsconfig}`)

    const sourceFile = project.program.getSourceFile(sourcePath)
    if (!sourceFile) throw new Error(`tsrs schema generator: ${sourcePath} is not in the program`)

    const checker = project.checker
    const sourceSymbol = checker.getSymbolOfSourceFile(sourcePath)
    if (!sourceSymbol) throw new Error(`tsrs schema generator: ${sourcePath} has no module symbol`)
    const rootSymbol = resolveTypeSymbol(sourceSymbol, SCHEMA_TYPE.split('.'))
    const rootType = checker.getDeclaredTypeOfSymbol(rootSymbol)

    const generator = createGenerator(project, SCHEMA_TYPE)
    const rootDefinition = {
      ...generator.buildCore(rootType),
      ...readAnnotations(rootSymbol, checker),
    }
    generator.definitions[SCHEMA_TYPE] = rootDefinition

    const schema = {
      $schema: DRAFT_07,
      $ref: `#/definitions/${encodeURIComponent(SCHEMA_TYPE)}`,
      definitions: generator.definitions,
    }

    // BuildUtilsWriteFile appends EOL, matching the previous TJS call site.
    await BuildUtilsWriteFile(AppSettingsDevJSONSchemaFilePath, JSON.stringify(schema, null, 2))
  } finally {
    api.close()
  }
}
