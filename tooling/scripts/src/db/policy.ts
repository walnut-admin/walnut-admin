/**
 * seed 数据的**裁剪策略** —— `db:export:pg`（写快照）与 `lint:seed`（门禁自检）共用同一份规则。
 *
 * 为什么需要它：仓里的 `sys_user` 是**裁剪过**的（只留演示账号、头像外链置空），而库里的
 * 原始数据不是。若导出走"原样 dump"，那么「导出结果」与「仓内文件」永远对不上 ——
 * `pnpm db:export:pg` 之后 `git diff` 会永远飘着几行噪声，久了就没人再看这个 diff，
 * 「仓是唯一真源」这条约定也就失效了。
 *
 * 所以裁剪规则必须**只有一个家**（本文件），两个方向都从这里取：
 * 导出时套用它写文件，门禁再套一遍核对仓内文件确实裁过。
 *
 * 判据**两种形态都认**：导出侧是文档形态（`userName`），仓内 seed 与门禁是行形态（`user_name`）——
 * 同一份数据的两个投影，别为了命名法各写一条规则。
 *
 * 新增集合若要裁剪，改这里**同时**重新生成 seed（`db:export:pg` → `db:seed:reshape`）。
 */

/** 允许进仓的演示账号（其余是开发者本人账号 —— 原始导出里有 7 个，仓里只留这 2 个） */
export const DEMO_USER_NAMES = ['visitor', 'admin']

export interface SeedPolicy {
  /** 这条文档/行要不要进仓/进库 */
  keep?: (doc: Record<string, unknown>) => boolean
  /** 落盘前的归一化（例如把头像外链置空） */
  normalize?: (doc: Record<string, unknown>) => Record<string, unknown>
}

/** 用户名（文档形态 `userName` / 行形态 `user_name` 都认） */
function userNameOf(doc: Record<string, unknown>): unknown {
  return doc.user_name ?? doc.userName
}

/** 按集合名取策略；没有条目的集合 = 原样 */
export const SEED_POLICY: Record<string, SeedPolicy> = {
  sys_user: {
    keep: doc => DEMO_USER_NAMES.includes(String(userNameOf(doc))),
    // avatar 两形态同名，直接置空
    normalize: doc => ({ ...doc, avatar: null }),
  },
}

/** 对一批文档/行套用策略（导出与门禁共用；顺序保持稳定，排序由调用方负责） */
export function applyPolicy(collection: string, docs: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const policy = SEED_POLICY[collection]
  if (policy === undefined)
    return [...docs]
  return docs
    .filter(doc => policy.keep === undefined || policy.keep(doc))
    .map(doc => (policy.normalize === undefined ? doc : policy.normalize(doc)))
}
