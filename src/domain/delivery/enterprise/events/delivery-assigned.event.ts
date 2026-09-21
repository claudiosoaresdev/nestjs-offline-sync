import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvent } from '@/core/events/domain-event'

export class DeliveryAssignedEvent implements DomainEvent {
  public readonly occurredAt: Date

  constructor(
    public readonly deliveryId: UniqueEntityID,
    public readonly courierId: UniqueEntityID,
    public readonly previousCourierId: UniqueEntityID | null,
  ) {
    this.occurredAt = new Date()
  }

  getAggregateId(): UniqueEntityID {
    return this.deliveryId
  }
}
