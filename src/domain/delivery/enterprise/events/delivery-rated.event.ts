import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvent } from '@/core/events/domain-event'

export class DeliveryRatedEvent implements DomainEvent {
  public readonly occurredAt: Date

  constructor(
    public readonly deliveryId: UniqueEntityID,
    public readonly courierId: UniqueEntityID,
    public readonly score: number,
  ) {
    this.occurredAt = new Date()
  }

  getAggregateId(): UniqueEntityID {
    return this.deliveryId
  }
}
