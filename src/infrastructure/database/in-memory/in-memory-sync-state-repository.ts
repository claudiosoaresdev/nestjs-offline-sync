import { Injectable } from '@nestjs/common'

import { SyncStateRepository } from '@/domain/delivery/application/repositories/sync-state-repository'

@Injectable()
export class InMemorySyncStateRepository extends SyncStateRepository {
  private version = 0

  /**
   * Síncrono de propósito: é o único ponto que atribui versão, e não pode
   * existir `await` entre incrementar e gravar a entrada no log.
   */
  increment(): number {
    this.version += 1

    return this.version
  }

  currentVersion(): Promise<number> {
    return Promise.resolve(this.version)
  }
}
