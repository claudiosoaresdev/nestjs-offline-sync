import { beforeEach, describe, expect, it, vi } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvents } from '@/core/events/domain-events'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { DeliveryItem } from '@/domain/delivery/enterprise/entities/delivery-item'
import { Product } from '@/domain/delivery/enterprise/entities/product'
import { Quantity } from '@/domain/delivery/enterprise/entities/quantity'
import { DeliveryCancelledEvent } from '@/domain/delivery/enterprise/events/delivery-cancelled.event'
import { DeliveryCreatedEvent } from '@/domain/delivery/enterprise/events/delivery-created.event'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'

let sut: InMemoryDeliveriesRepository

function makeItem(): DeliveryItem {
  const quantity = Quantity.create(1)

  if (quantity.isLeft()) throw new Error('quantity inválida no setup')

  return DeliveryItem.fromProduct(
    Product.create({ name: 'Café', priceCents: 1990 }),
    quantity.value,
  )
}

function makeDelivery(courierId = new UniqueEntityID()): Delivery {
  return Delivery.create({
    courierId,
    customer: CustomerInfo.create({
      name: 'Maria',
      phone: '11999999999',
      address: 'Rua A, 100',
    }),
    items: [makeItem()],
  })
}

describe('InMemoryDeliveriesRepository', () => {
  beforeEach(() => {
    sut = new InMemoryDeliveriesRepository()
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()
  })

  it('save de entrega existente grava e despacha evento', async () => {
    const delivery = makeDelivery()

    await sut.create(delivery)

    const handler = vi.fn()
    DomainEvents.register(handler, DeliveryCancelledEvent.name)

    delivery.cancel('cliente desistiu')

    await sut.save(delivery)

    expect(sut.items[0]).toBe(delivery)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('save de entrega inexistente não grava e não despacha evento', async () => {
    const handler = vi.fn()
    DomainEvents.register(handler, DeliveryCreatedEvent.name)

    const delivery = makeDelivery()

    await sut.save(delivery)

    expect(sut.items).toHaveLength(0)
    expect(handler).not.toHaveBeenCalled()
  })

  it('findManyByCourier sem cursor devolve a partir do início, respeitando o limite', async () => {
    const courierId = new UniqueEntityID()
    const first = makeDelivery(courierId)
    const second = makeDelivery(courierId)

    await sut.create(first)
    await sut.create(second)

    const rows = await sut.findManyByCourier({
      courierId: courierId.toString(),
      limit: 10,
    })

    expect(rows).toHaveLength(2)
  })

  it('findManyByCourier com cursor válido devolve os itens após o cursor', async () => {
    const courierId = new UniqueEntityID()
    const first = makeDelivery(courierId)
    const second = makeDelivery(courierId)

    await sut.create(first)
    await sut.create(second)

    const ordered = [first, second].sort((a, b) =>
      a.id.toString().localeCompare(b.id.toString()),
    )

    const rows = await sut.findManyByCourier({
      courierId: courierId.toString(),
      limit: 10,
      cursor: ordered[0].id.toString(),
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].id.toString()).toBe(ordered[1].id.toString())
  })

  it('findManyByCourier com cursor inexistente devolve lista vazia', async () => {
    const courierId = new UniqueEntityID()

    await sut.create(makeDelivery(courierId))

    const rows = await sut.findManyByCourier({
      courierId: courierId.toString(),
      limit: 10,
      cursor: new UniqueEntityID().toString(),
    })

    expect(rows).toEqual([])
  })

  it('a carteira exclui entrega cancelada e mantém entregue', async () => {
    const courierId = new UniqueEntityID()

    const cancelled = makeDelivery(courierId)
    cancelled.cancel('cliente desistiu')

    const delivered = makeDelivery(courierId)
    delivered.markOutForDelivery(new Date())
    delivered.markDelivered('porteiro', new Date())

    const pending = makeDelivery(courierId)

    await sut.create(cancelled)
    await sut.create(delivered)
    await sut.create(pending)

    const rows = await sut.findManyByCourier({
      courierId: courierId.toString(),
      limit: 10,
    })

    const ids = rows.map((row) => row.id.toString())

    expect(ids).toContain(delivered.id.toString())
    expect(ids).toContain(pending.id.toString())
    expect(ids).not.toContain(cancelled.id.toString())
  })

  it('countByCourier conta só as entregas ativas', async () => {
    const courierId = new UniqueEntityID()

    const cancelled = makeDelivery(courierId)
    cancelled.cancel('cliente desistiu')

    const pending = makeDelivery(courierId)

    await sut.create(cancelled)
    await sut.create(pending)

    await expect(sut.countByCourier(courierId.toString())).resolves.toBe(1)
  })
})
