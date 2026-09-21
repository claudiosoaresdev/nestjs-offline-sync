import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvent } from '@/core/events/domain-event'

export class DeliveryCancelledEvent implements DomainEvent {
  public readonly occurredAt: Date

  constructor(
    public readonly deliveryId: UniqueEntityID,
    public readonly courierId: UniqueEntityID,
    public readonly reason: string,
  ) {
    this.occurredAt = new Date()
  }

  getAggregateId(): UniqueEntityID {
    return this.deliveryId
  }
}
