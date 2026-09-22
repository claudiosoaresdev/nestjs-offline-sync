import { Injectable } from '@nestjs/common'

import {
  AppendDeliveryChangeInput,
  DeliveryChangesRepository,
  FindChangesForCourierParams,
  HasChangesForCourierAfterParams,
} from '@/domain/delivery/application/repositories/delivery-changes-repository'
import { DeliveryChange } from '@/domain/delivery/enterprise/entities/delivery-change'
import { InMemorySyncStateRepository } from '@/infrastructure/database/in-memory/in-memory-sync-state-repository'

@Injectable()
export class InMemoryDeliveryChangesRepository extends DeliveryChangesRepository {
  public items: DeliveryChange[] = []

  constructor(private readonly syncState: InMemorySyncStateRepository) {
    super()
  }

  append(input: AppendDeliveryChangeInput): Promise<DeliveryChange> {
    const change = DeliveryChange.create({
      version: this.syncState.increment(),
      type: input.type,
      deliveryId: input.deliveryId,
      courierId: input.courierId,
    })

    this.items.push(change)

    return Promise.resolve(change)
  }

  findManyForCourierSince({
    courierId,
    sinceVersion,
    limit,
  }: FindChangesForCourierParams): Promise<DeliveryChange[]> {
    const rows = this.items
      .filter(
        (item) =>
          item.courierId.toString() === courierId &&
          item.version > sinceVersion,
      )
      .sort((a, b) => a.version - b.version)
      .slice(0, limit)

    return Promise.resolve(rows)
  }

  hasChangesForCourierAfter({
    courierId,
    version,
  }: HasChangesForCourierAfterParams): Promise<boolean> {
    return Promise.resolve(
      this.items.some(
        (item) =>
          item.courierId.toString() === courierId && item.version > version,
      ),
    )
  }

  /** O in-memory nunca descarta histórico, então o piso é sempre 0. */
  minVersion(): Promise<number> {
    return Promise.resolve(0)
  }
}
