import { describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DeliveryChange } from '@/domain/delivery/enterprise/entities/delivery-change'

describe('DeliveryChange', () => {
  it('guarda versão, tipo, entrega e courier', () => {
    const deliveryId = new UniqueEntityID()
    const courierId = new UniqueEntityID()

    const change = DeliveryChange.create({
      version: 7,
      type: 'UPSERT',
      deliveryId,
      courierId,
    })

    expect(change.version).toBe(7)
    expect(change.type).toBe('UPSERT')
    expect(change.deliveryId.equals(deliveryId)).toBe(true)
    expect(change.courierId.equals(courierId)).toBe(true)
    expect(change.occurredAt).toBeInstanceOf(Date)
  })

  it('aceita REMOVE como tombstone de escopo', () => {
    const change = DeliveryChange.create({
      version: 8,
      type: 'REMOVE',
      deliveryId: new UniqueEntityID(),
      courierId: new UniqueEntityID(),
    })

    expect(change.type).toBe('REMOVE')
  })

  it('preserva occurredAt explícito', () => {
    const now = new Date('2026-09-21T15:00:00Z')
    const deliveryId = new UniqueEntityID()
    const courierId = new UniqueEntityID()

    const change = DeliveryChange.create({
      version: 9,
      type: 'UPSERT',
      deliveryId,
      courierId,
      occurredAt: now,
    })

    expect(change.occurredAt).toEqual(now)
  })

  it('duas mudanças com mesmos dados são iguais por valor', () => {
    const deliveryId = new UniqueEntityID()
    const courierId = new UniqueEntityID()
    const occurredAt = new Date('2026-09-21T15:00:00Z')

    const change1 = DeliveryChange.create({
      version: 10,
      type: 'UPSERT',
      deliveryId,
      courierId,
      occurredAt,
    })

    const change2 = DeliveryChange.create({
      version: 10,
      type: 'UPSERT',
      deliveryId,
      courierId,
      occurredAt,
    })

    expect(change1.equals(change2)).toBe(true)
  })
})
