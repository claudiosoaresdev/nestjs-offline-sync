import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { InMemoryDeliveryChangesRepository } from '@/infrastructure/database/in-memory/in-memory-delivery-changes-repository'
import { InMemorySyncStateRepository } from '@/infrastructure/database/in-memory/in-memory-sync-state-repository'

let syncState: InMemorySyncStateRepository
let sut: InMemoryDeliveryChangesRepository

const courierId = new UniqueEntityID()
const otherCourierId = new UniqueEntityID()

describe('InMemoryDeliveryChangesRepository', () => {
  beforeEach(() => {
    syncState = new InMemorySyncStateRepository()
    sut = new InMemoryDeliveryChangesRepository(syncState)
  })

  it('atribui versões crescentes e avança o sync state', async () => {
    const first = await sut.append({
      type: 'UPSERT',
      deliveryId: new UniqueEntityID(),
      courierId,
    })
    const second = await sut.append({
      type: 'UPSERT',
      deliveryId: new UniqueEntityID(),
      courierId,
    })

    expect(first.version).toBe(1)
    expect(second.version).toBe(2)
    await expect(syncState.currentVersion()).resolves.toBe(2)
  })

  it('filtra por courier e por cursor, em ordem crescente', async () => {
    await sut.append({
      type: 'UPSERT',
      deliveryId: new UniqueEntityID(),
      courierId,
    })
    await sut.append({
      type: 'UPSERT',
      deliveryId: new UniqueEntityID(),
      courierId: otherCourierId,
    })
    const third = await sut.append({
      type: 'UPSERT',
      deliveryId: new UniqueEntityID(),
      courierId,
    })

    const rows = await sut.findManyForCourierSince({
      courierId: courierId.toString(),
      sinceVersion: 1,
      limit: 10,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].version).toBe(third.version)
  })

  it('respeita o limite', async () => {
    for (let index = 0; index < 5; index += 1) {
      await sut.append({
        type: 'UPSERT',
        deliveryId: new UniqueEntityID(),
        courierId,
      })
    }

    const rows = await sut.findManyForCourierSince({
      courierId: courierId.toString(),
      sinceVersion: 0,
      limit: 2,
    })

    expect(rows.map((row) => row.version)).toEqual([1, 2])
  })

  it('sabe dizer se há mudanças acima de uma versão', async () => {
    await sut.append({
      type: 'UPSERT',
      deliveryId: new UniqueEntityID(),
      courierId,
    })

    await expect(
      sut.hasChangesForCourierAfter({
        courierId: courierId.toString(),
        version: 0,
      }),
    ).resolves.toBe(true)
    await expect(
      sut.hasChangesForCourierAfter({
        courierId: courierId.toString(),
        version: 1,
      }),
    ).resolves.toBe(false)
  })

  it('minVersion() devolve 0', async () => {
    await sut.append({
      type: 'UPSERT',
      deliveryId: new UniqueEntityID(),
      courierId,
    })

    await expect(sut.minVersion()).resolves.toBe(0)
  })

  it('sinceVersion acima da maior versão existente devolve lista vazia', async () => {
    await sut.append({
      type: 'UPSERT',
      deliveryId: new UniqueEntityID(),
      courierId,
    })

    const rows = await sut.findManyForCourierSince({
      courierId: courierId.toString(),
      sinceVersion: 999,
      limit: 10,
    })

    expect(rows).toEqual([])
  })
})
