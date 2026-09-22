import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvent } from '@/core/events/domain-event'
import { DeliveryStatusValue } from '@/domain/delivery/enterprise/entities/delivery-status'

export class DeliveryStatusChangedEvent implements DomainEvent {
  public readonly occurredAt: Date

  constructor(
    public readonly deliveryId: UniqueEntityID,
    public readonly courierId: UniqueEntityID,
    public readonly status: DeliveryStatusValue,
  ) {
    this.occurredAt = new Date()
  }

  getAggregateId(): UniqueEntityID {
    return this.deliveryId
  }
}
