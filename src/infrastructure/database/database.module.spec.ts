import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import { beforeAll, describe, expect, it } from 'vitest'

import { DeliveriesRepository } from '@/domain/delivery/application/repositories/deliveries-repository'
import { DeliveryChangesRepository } from '@/domain/delivery/application/repositories/delivery-changes-repository'
import { SyncStateRepository } from '@/domain/delivery/application/repositories/sync-state-repository'
import { DatabaseModule } from '@/infrastructure/database/database.module'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'
import { InMemoryDeliveryChangesRepository } from '@/infrastructure/database/in-memory/in-memory-delivery-changes-repository'
import { InMemorySyncStateRepository } from '@/infrastructure/database/in-memory/in-memory-sync-state-repository'

// Este teste não instancia nada na mão: ele compila o módulo real do Nest e
// resolve pelo container, exatamente como a aplicação faria. É o único teste
// que pega um `useClass` acidental no lugar de `useExisting` — os specs dos
// repositórios in-memory constroem as instâncias manualmente e passariam
// mesmo com o wiring errado, porque nunca passam pelo container de DI.
describe('DatabaseModule', () => {
  let moduleRef: TestingModule

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile()
  })

  it('SyncStateRepository e InMemorySyncStateRepository resolvem para a mesma instância', () => {
    const contract = moduleRef.get(SyncStateRepository)
    const concrete = moduleRef.get(InMemorySyncStateRepository)

    expect(contract).toBe(concrete)
  })

  it('DeliveryChangesRepository e InMemoryDeliveryChangesRepository resolvem para a mesma instância', () => {
    const contract = moduleRef.get(DeliveryChangesRepository)
    const concrete = moduleRef.get(InMemoryDeliveryChangesRepository)

    expect(contract).toBe(concrete)
  })

  it('DeliveriesRepository e InMemoryDeliveriesRepository resolvem para a mesma instância', () => {
    const contract = moduleRef.get(DeliveriesRepository)
    const concrete = moduleRef.get(InMemoryDeliveriesRepository)

    expect(contract).toBe(concrete)
  })
})
