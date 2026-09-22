import { Injectable } from '@nestjs/common'

import { DomainEvents } from '@/core/events/domain-events'
import {
  DeliveriesRepository,
  FindManyByCourierParams,
} from '@/domain/delivery/application/repositories/deliveries-repository'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'

@Injectable()
export class InMemoryDeliveriesRepository extends DeliveriesRepository {
  public items: Delivery[] = []

  findById(id: string): Promise<Delivery | null> {
    return Promise.resolve(
      this.items.find((item) => item.id.toString() === id) ?? null,
    )
  }

  findManyByCourier({
    courierId,
    limit,
    cursor,
  }: FindManyByCourierParams): Promise<Delivery[]> {
    const ordered = this.activeForCourier(courierId)

    // Keyset: filtra por id > cursor em vez de localizar o índice do cursor
    // na lista. Equivalente a `WHERE id > $cursor ORDER BY id` no Postgres —
    // não depende de o cursor ainda existir na lista filtrada.
    const rows = cursor
      ? ordered.filter((item) => item.id.toString() > cursor)
      : ordered

    return Promise.resolve(rows.slice(0, limit))
  }

  countByCourier(courierId: string): Promise<number> {
    return Promise.resolve(this.activeForCourier(courierId).length)
  }

  create(delivery: Delivery): Promise<void> {
    this.items.push(delivery)

    DomainEvents.dispatchEventsForAggregate(delivery.id)

    return Promise.resolve()
  }

  save(delivery: Delivery): Promise<void> {
    const index = this.items.findIndex((item) => item.equals(delivery))

    if (index >= 0) {
      this.items[index] = delivery

      DomainEvents.dispatchEventsForAggregate(delivery.id)
    }

    return Promise.resolve()
  }

  /** Entrega cancelada sai da carteira; entregue continua, porque ainda recebe avaliação. */
  private activeForCourier(courierId: string): Delivery[] {
    return this.items
      .filter(
        (item) =>
          item.courierId.toString() === courierId &&
          item.status.value !== 'CANCELLED',
      )
      .sort((a, b) => (a.id.toString() < b.id.toString() ? -1 : 1))
  }
}
