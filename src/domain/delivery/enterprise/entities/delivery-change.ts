import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { ValueObject } from '@/core/entities/value-object'
import { Optional } from '@/core/types/optional'

export type DeliveryChangeType = 'UPSERT' | 'REMOVE'

export interface DeliveryChangeProps {
  version: number
  type: DeliveryChangeType
  deliveryId: UniqueEntityID
  courierId: UniqueEntityID
  occurredAt: Date
}

export class DeliveryChange extends ValueObject<DeliveryChangeProps> {
  private constructor(props: DeliveryChangeProps) {
    super(props)
  }

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
  ): DeliveryChange {
    return new DeliveryChange({
      ...props,
      occurredAt: props.occurredAt ?? new Date(),
    })
  }
}
