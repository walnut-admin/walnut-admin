import { Injectable } from '@nestjs/common'
import {
  SysLangDTOCreateRequest,
  SysLangDTOListRequest,
  SysLangDTOUpdateRequest,
} from './dto/lang.dto'
import { SysLangBasicRepository } from './lang.basic.repository'
import { SysLangRepoService } from './repo/lang.repo.service'

/**
 * Lang Service
 *
 * This service has 1:1 mapping with controller endpoints.
 * NO direct Model usage - all data access through Repository/Repo Service layer.
 */
@Injectable()
export class SysLangService {
  constructor(
    private readonly langBasicRepo: SysLangBasicRepository,
    private readonly langRepoService: SysLangRepoService,
  ) {}

  /**
   * @description create lang (controller: create)
   */
  async create(dto: SysLangDTOCreateRequest) {
    return this.langBasicRepo.create(dto)
  }

  /**
   * @description read lang by id (controller: read)
   */
  async read(id: string) {
    return this.langRepoService.findByIdWithLocaleCounts(id)
  }

  /**
   * @description update lang (controller: update)
   */
  async update(id: string, dto: SysLangDTOUpdateRequest) {
    return this.langBasicRepo.update(id, dto)
  }

  /**
   * @description list langs (controller: list)
   *
   * Mongo 版的 locale 计数 / process 管道随 B2 迁入 lang.basic.repository 的 PG list 覆写
   */
  async list(payload: SysLangDTOListRequest) {
    return this.langBasicRepo.list(payload)
  }

  /**
   * @description public language list, no auth (controller: listPublic)
   */
  async listPublic() {
    return this.langRepoService.findPublic()
  }
}
