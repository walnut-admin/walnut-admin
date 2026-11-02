import { Role } from '@walnut/contract'

/**
 * 阿里云 OSS STS 最小权限 policy 构造（F-12 纯函数，单测见 ali.policy.spec.ts）
 *
 * 为什么必须始终带 policy：STS AssumeRole 不带 policy 时，临时凭证**继承 roleArn 的全部权限**
 * （本项目的 roleArn 是默认 OSS FullAccess 角色，见 review 的 R3 核实结论）。改造前只有
 * visitor 带 policy（且 Resource 是 *），非 visitor 一律 undefined —— 任何登录用户拿到的
 * STS 都能读写/删除整个 bucket。
 *
 * 现在三态：
 * 1. visitor：只读（oss:GetObject + oss:ListObjects，后者是桶级动作，单独一条 statement），
 *    与改造前语义一致但资源收窄到本 bucket；
 * 2. 非 visitor：只读 + 上传动作（oss:PutObject / oss:AbortMultipartUpload / oss:ListParts，
 *    后两个是 ali-oss 分片上传的续传与中止腿 —— apps/admin 的 OSSUpload 客户端会调
 *    multipartUpload（带 checkpoint 续传，内部 ListParts）与 abortMultipartUpload）；
 * 3. 显式给出 objectKeyPrefix：对象资源进一步收窄到该前缀，并给 ListObjects 加
 *    oss:Prefix 条件，避免「列整个 bucket」。
 *
 * **为什么当前调用方传的是 null（不给前缀）**：apps/admin 的对象键是
 * `${folder}/${fileName}`（OSSUpload 组件的 folder prop，默认 'example'），**没有任何
 * userId 前缀** —— 硬收窄到某个用户前缀会直接把上传打坏。所以退化为「bucket 级 Action
 * 白名单 + 对象资源限定在本 bucket」；等前端把用户前缀写进对象键（或后端改成服务端拼键）
 * 后，把前缀传进来即可自动收窄，本函数无需再改。
 *
 * 故意**不给** oss:DeleteObject：admin 侧 OSSUpload 客户端只有 put / multipartUpload /
 * abortMultipartUpload / getFullUrl，没有任何删除调用。真需要删除时显式加进 UploadActions，
 * 不要整段放开。
 */

/** 对象级只读动作：visitor 的上限，也是所有用户的下限（ListObjects 是桶级动作，单列一条） */
const ReadOnlyActions = ['oss:GetObject'] as const

/** 上传动作：只有非 visitor 才叠加（PutObject 覆盖简单上传与分片上传的各段） */
const UploadActions = ['oss:PutObject', 'oss:AbortMultipartUpload', 'oss:ListParts'] as const

export interface IWalnutAdminAliOSSStsPolicyInput {
  /** 当前登录角色名：Role.VISITOR → 只读 */
  currentRoleName: string
  /** OSS bucket 名（VENDOR_KEYS_ALI_OSS_BUCKET） */
  bucket: string
  /** 用户维度对象键前缀（如 u/<userId>）。为空 = 不做用户维度收窄（当前口径） */
  objectKeyPrefix?: string | null
}

interface AliOSSStsPolicyStatement {
  Effect: 'Allow'
  Action: string[]
  Resource: string[]
  Condition?: { StringLike: Record<string, string[]> }
}

/** 归一化前缀：去掉首尾多余的 /，空串（或未给）视为「不收窄」 */
function normalizeObjectKeyPrefix(prefix?: string | null) {
  if (prefix === undefined || prefix === null)
    return ''

  return prefix.trim().replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * @description 构造 STS AssumeRole 的 policy（JSON 字符串，直接塞进 AssumeRoleRequest.policy）
 */
export function buildAliOSSStsPolicy(input: IWalnutAdminAliOSSStsPolicyInput): string {
  const bucket = input.bucket?.trim()

  if (!bucket) {
    // fail-closed：配置缺失时宁可让签发失败，也不退回 Resource: * 这种 fail-open 形态
    throw new Error(
      '[ali-oss] VENDOR_KEYS_ALI_OSS_BUCKET 未配置，无法构造最小权限 STS policy',
    )
  }

  const prefix = normalizeObjectKeyPrefix(input.objectKeyPrefix)
  const isVisitor = input.currentRoleName === Role.VISITOR

  const actions = isVisitor
    ? [...ReadOnlyActions]
    : [...ReadOnlyActions, ...UploadActions]

  // 对象级资源：有前缀时只给它下面的对象，否则给本 bucket 下所有对象（仍限定在单 bucket）
  const objectScope = prefix ? `${prefix}/*` : '*'

  const statements: AliOSSStsPolicyStatement[] = [
    {
      Effect: 'Allow',
      Action: actions,
      Resource: [`acs:oss:*:*:${bucket}/${objectScope}`],
    },
    {
      // ListObjects 是 **bucket 级** 动作（资源必须是 acs:oss:*:*:<bucket>，不能带 /*），
      // 所以它单独一条；有用户前缀时用 oss:Prefix 条件把「能列出哪些」也收窄。
      Effect: 'Allow',
      Action: ['oss:ListObjects'],
      Resource: [`acs:oss:*:*:${bucket}`],
      ...(prefix
        ? { Condition: { StringLike: { 'oss:Prefix': [objectScope] } } }
        : {}),
    },
  ]

  return JSON.stringify({ Version: '1', Statement: statements })
}
