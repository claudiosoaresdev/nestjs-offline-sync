import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvent } from '@/core/events/domain-event'

export class DeliveryDetailsChangedEvent implements DomainEvent {
  public readonly occurredAt: Date

  constructor(
    public readonly deliveryId: UniqueEntityID,
    public readonly courierId: UniqueEntityID,
  ) {
    this.occurredAt = new Date()
  }

  getAggregateId(): UniqueEntityID {
    return this.deliveryId
  }
}
