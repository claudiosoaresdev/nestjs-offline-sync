import { Entity } from '@/core/entities/entity'
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { Optional } from '@/core/types/optional'

export type DeliveryChangeType = 'UPSERT' | 'REMOVE'

export interface DeliveryChangeProps {
  version: number
  type: DeliveryChangeType
  deliveryId: UniqueEntityID
  courierId: UniqueEntityID
  occurredAt: Date
}

export class DeliveryChange extends Entity<DeliveryChangeProps> {
  get version(): number {
    return this.props.version
  }

  get type(): DeliveryChangeType {
    return this.props.type
  }

  get deliveryId(): UniqueEntityID {
    return this.props.deliveryId
  }

  get courierId(): UniqueEntityID {
    return this.props.courierId
  }

  get occurredAt(): Date {
    return this.props.occurredAt
  }

  static create(
    props: Optional<DeliveryChangeProps, 'occurredAt'>,
    id?: UniqueEntityID,
  ): DeliveryChange {
    return new DeliveryChange(
      { ...props, occurredAt: props.occurredAt ?? new Date() },
      id,
    )
  }
}
