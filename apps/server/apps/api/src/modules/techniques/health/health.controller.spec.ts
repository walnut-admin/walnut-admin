import { describe, expect, it } from 'vitest'
import { getDiskHealthCheckPath } from './health.controller'

// P3-22：disk 健康检查路径此前硬编码 `C:/`，非 Windows 部署恒失败（DiskHealthIndicator
// 抛错 → 全局兜底 50000）。单测钉住平台分支；HTTP 层的「受控二值」仍由 health.api-spec 覆盖。
describe('app/health disk 根路径（P3-22 跨平台）', () => {
  it('win32 → 系统盘 C:/', () => {
    expect(getDiskHealthCheckPath('win32')).toBe('C:/')
  })

  it('linux / darwin 等类 Unix → /', () => {
    expect(getDiskHealthCheckPath('linux')).toBe('/')
    expect(getDiskHealthCheckPath('darwin')).toBe('/')
  })
})
