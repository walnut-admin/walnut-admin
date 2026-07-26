import { Injectable, Logger } from '@nestjs/common'
import { IWalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { arrToTree, formatTree, TreeNodeItem } from 'easy-fns-ts'

import { cloneDeep, omit } from 'lodash'
import { MurLockService } from 'murlock'

import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'
import { ISharedAreaModel, SharedAreaModel } from './schema/area.schema'

@Injectable()
export class SharedAreaService {
  private readonly logger = new Logger(SharedAreaService.name)

  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SHARED_AREA)
    private readonly sharedAreaModel: ISharedAreaModel,
    private readonly cacheService: AppTechCacheService,
    private readonly murLockService: MurLockService,
  ) {}

  /**
   * Get cache key based on area code length
   * @param code Area code (2-digit = province, 4-digit = city, etc.)
   * @returns Corresponding cache key from WalnutAdminConstAppCacheKeys
   */
  private getCacheKeyByCode(code: string) {
    const obj: Record<number, IWalnutAdminConstAppCacheKeys> = {
      2: WalnutAdminConstAppCacheKeys.SHARED_AREA_PROVINCE,
      4: WalnutAdminConstAppCacheKeys.SHARED_AREA_CITY,
      6: WalnutAdminConstAppCacheKeys.SHARED_AREA_DISTRICT,
      9: WalnutAdminConstAppCacheKeys.SHARED_AREA_STREET,
      12: WalnutAdminConstAppCacheKeys.SHARED_AREA_VILLAGE,
    }
    return obj[code.length]
  }

  /**
   * Get cache key based on parent area code length
   * @param pcode Parent area code (e.g., '0' = top-level, 2-digit = province-level parent)
   * @returns Corresponding cache key from WalnutAdminConstAppCacheKeys
   */
  private getCacheKeyByPcode(pcode: string) {
    const obj: Record<number, IWalnutAdminConstAppCacheKeys> = {
      1: WalnutAdminConstAppCacheKeys.SHARED_AREA_PROVINCE,
      2: WalnutAdminConstAppCacheKeys.SHARED_AREA_CITY,
      4: WalnutAdminConstAppCacheKeys.SHARED_AREA_DISTRICT,
      6: WalnutAdminConstAppCacheKeys.SHARED_AREA_STREET,
      9: WalnutAdminConstAppCacheKeys.SHARED_AREA_VILLAGE,
    }
    return obj[pcode.length]
  }

  /**
   * Get same-level areas by area code (with cache support)
   * @param code Target area code
   * @returns Cloned array of same-level area models (avoids reference issues)
   */
  async getSameLevelByCodeWithCache(code: string) {
    if (!code)
      return []

    const CACHE_KEY = this.getCacheKeyByCode(code)
    const cachedData = await this.cacheService.get<SharedAreaModel[]>(CACHE_KEY)

    // Return same-level data from cache if target code exists in cache
    if (cachedData?.some(i => i.code === code)) {
      return cloneDeep(
        cachedData.filter(i => i.code.startsWith(code.slice(0, -2))),
      )
    }

    // Query target area from DB to get its parent code (pcode)
    const target = await this.sharedAreaModel
      .findOne({ code })
      .select('-_id name code pcode')
      .lean()

    if (!target)
      return []

    // Get children of the target's parent (i.e., target's same-level areas)
    return this.getChildrenByPcodeWithCache(target.pcode)
  }

  /**
   * Get child areas by parent code (with cache support)
   * @param pcode Parent area code (default: '0' for top-level areas like provinces)
   * @returns Array of child area models
   */
  async getChildrenByPcodeWithCache(pcode: string = '0') {
    const CACHE_KEY = this.getCacheKeyByPcode(pcode)
    const cachedData = await this.cacheService.get<SharedAreaModel[]>(CACHE_KEY)

    // Fast path: cache has data for current pcode, return immediately without lock
    if (cachedData?.some(i => i.pcode === pcode)) {
      return cloneDeep(cachedData.filter(i => i.pcode === pcode))
    }

    // Slow path: cache miss or partial miss, acquire distributed lock to prevent race
    const lockKey = `${WalnutAdminConstAppCacheKeys.APP_MURLOCK}:AREA:CACHE:${CACHE_KEY}`

    return this.murLockService.runWithLock(
      lockKey,
      3000,
      async () => {
        // Double-check: re-read cache after acquiring lock
        const doubleCheckData = await this.cacheService.get<SharedAreaModel[]>(CACHE_KEY)

        // Another request already populated the cache while we waited for the lock
        if (doubleCheckData?.some(i => i.pcode === pcode)) {
          return cloneDeep(doubleCheckData.filter(i => i.pcode === pcode))
        }

        // Still a miss, query the database
        const res = await this.sharedAreaModel
          .find({ pcode })
          .select('-_id name code pcode')
          .lean()

        if (doubleCheckData === null) {
          await this.cacheService.set(CACHE_KEY, res, {
            t: WalnutAdminConstAppCacheType.SHARED,
          })
        }
        else {
          await this.cacheService.set(CACHE_KEY, doubleCheckData.concat(res), {
            t: WalnutAdminConstAppCacheType.SHARED,
          })
        }

        return res
      },
    )
  }

  /**
   * Build area response tree (for feedback/echo scenarios)
   *
   * Critical Fix: In feedback scenarios, `isLeaf` should be determined by "the deepest level in returned data".
   *               Nodes at the same level will have consistent `isLeaf` values (only the deepest level is `true`).
   * @param data Flat array of area models to build into a tree
   * @returns Formatted area tree with `depth` and `isLeaf` properties
   */
  private buildAreaResponseTree(data: SharedAreaModel[]) {
    if (data === null || data.length === 0)
      return []

    // Mapping: Area code length to area level (0 = province, 1 = city, 2 = district, etc.)
    const depthMap: Record<number, number> = {
      2: 0,
      4: 1,
      6: 2,
      9: 3,
      12: 4,
    }

    // Calculate levels of all nodes in data, then get the maximum level (deepest level in returned data)
    const nodeDepths = data
      .map(d => depthMap[d.code.length])
      .filter(d => typeof d === 'number')
    const maxDepthPresent = nodeDepths.length ? Math.max(...nodeDepths) : 0

    /**
     * Decorate tree nodes with `depth` and `isLeaf` properties
     * @param node Original tree node (contains `children` field)
     * @returns Decorated node (without `children` field, with `depth` and `isLeaf`)
     */
    const decorateNode = (node: SharedAreaModel) => {
      const nodeDepth = depthMap[node.code.length]
      return {
        ...omit(node, 'children'), // Remove `children` field from final response
        depth: nodeDepth,
        // Consistent at same level: Only mark as leaf if node is at the deepest level (maxDepthPresent)
        isLeaf: nodeDepth === maxDepthPresent,
      }
    }

    // Convert flat array to tree, then format nodes with `decorateNode`
    return formatTree(arrToTree(data, { id: 'code', pid: 'pcode' }), decorateNode)
  }

  /**
   * Get area tree branch for a single area code (feedback/echo)
   * @param code Target area code
   * @returns Formatted area tree branch (from target area up to top-level)
   */
  async feedback(code: string) {
    if (!code)
      return []

    // Special handling for province-level code (only provinces exist in returned data)
    if (code.length === 2) {
      const level1 = await this.getSameLevelByCodeWithCache(code)
      // Still return `isLeaf: true` here, since only provinces exist, maxDepth = 0
      return level1.map(i => ({ ...i, depth: 0, isLeaf: true }))
    }

    const levelsCollected: SharedAreaModel[][] = [] // Stores same-level areas for each level (from target upward)
    let currentCode = code

    // Traverse upward from target area to collect same-level areas for each parent level
    while (currentCode && currentCode.length >= 2) {
      const sameLevel = await this.getSameLevelByCodeWithCache(currentCode)
      if (sameLevel === null || sameLevel.length === 0)
        break

      levelsCollected.push(sameLevel)

      // Get parent code of current level (all same-level areas share the same parent)
      const parentPcode = sameLevel[0]?.pcode
      if (!parentPcode || parentPcode.length < 2)
        break

      currentCode = parentPcode
    }

    // Reverse to ensure parent levels come first (required for `arrToTree`), then flatten to 1D array
    const flat = levelsCollected.reverse().flat()
    return this.buildAreaResponseTree(flat)
  }

  /**
   * Helper: Flatten formatted tree into flat node array (removes `children` field)
   * @param tree Formatted area tree (from `buildAreaResponseTree`)
   * @returns Flat array of area models (without `children` field)
   */
  private flattenTree(tree: SharedAreaModel[]): SharedAreaModel[] {
    const res: SharedAreaModel[] = []

    /**
     * Depth-First Search (DFS) to traverse tree and collect nodes
     * @param nodes Current level nodes to process
     */
    const dfs = (nodes: TreeNodeItem<SharedAreaModel>[]) => {
      if (nodes === null || !nodes.length)
        return
      for (const node of nodes) {
        // Remove `children` field (will be reprocessed during final tree building)
        res.push(omit(node, 'children'))
        // Recursively process child nodes if they exist
        if (node.children && node.children.length)
          dfs(node.children)
      }
    }

    dfs(tree)
    return res
  }

  /**
   * Get merged area tree for multiple area codes (feedback/echo)
   * @param codes Array of target area codes
   * @returns Merged, deduplicated formatted area tree
   */
  async feedbackMultiple(codes: string[]) {
    if (!codes?.length)
      return []

    const allNodes: SharedAreaModel[] = []

    // Collect and flatten tree nodes for each code
    for (const code of codes) {
      const tree = await this.feedback(code)
      const flat = this.flattenTree(tree)
      allNodes.push(...flat)
    }

    // Deduplicate nodes by code (one node per code; merge fields if duplicated)
    const uniqueMap = new Map<string, SharedAreaModel>()
    for (const node of allNodes) {
      if (!uniqueMap.has(node.code)) {
        uniqueMap.set(node.code, node)
      }
      else {
        // Merge existing node with new node (new node fields override existing ones)
        uniqueMap.set(node.code, { ...uniqueMap.get(node.code)!, ...node })
      }
    }

    // Convert Map values to array and build final merged tree
    return this.buildAreaResponseTree(Array.from(uniqueMap.values()))
  }
}
