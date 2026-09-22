import { describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DeliveryChangeView } from '@/domain/delivery/application/use-cases/pull-delivery-changes'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { DeliveryChangePresenter } from '@/infrastructure/http/presenters/delivery-change-presenter'

function makeDelivery(): Delivery {
  return Delivery.create({
    courierId: new UniqueEntityID(),
    customer: CustomerInfo.create({
      name: 'Maria',
      phone: '11999999999',
      address: 'Rua A, 100',
    }),
    items: [],
  })
}

describe('DeliveryChangePresenter', () => {
  it('serializa UPSERT com a entrega via DeliveryPresenter', () => {
    const delivery = makeDelivery()

    const change: DeliveryChangeView = {
      type: 'UPSERT',
      version: 3,
      deliveryId: delivery.id.toString(),
      delivery,
    }

    const http = DeliveryChangePresenter.toHTTP(change)

    expect(http).toEqual({
      type: 'UPSERT',
      version: 3,
      deliveryId: delivery.id.toString(),
      delivery: expect.objectContaining({
        id: delivery.id.toString(),
      }) as unknown,
    })
  })

  it('serializa REMOVE sem entrega', () => {
    const deliveryId = new UniqueEntityID().toString()

    const change: DeliveryChangeView = {
      type: 'REMOVE',
      version: 5,
      deliveryId,
    }

    const http = DeliveryChangePresenter.toHTTP(change)

    expect(http).toEqual({
      type: 'REMOVE',
      version: 5,
      deliveryId,
      delivery: undefined,
    })
  })
})
