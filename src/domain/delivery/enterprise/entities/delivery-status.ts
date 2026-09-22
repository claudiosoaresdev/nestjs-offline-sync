import { ValueObject } from '@/core/entities/value-object'

export const DELIVERY_STATUSES = [
  'PENDING',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
] as const

export type DeliveryStatusValue = (typeof DELIVERY_STATUSES)[number]

const ALLOWED_TRANSITIONS: Record<
  DeliveryStatusValue,
  readonly DeliveryStatusValue[]
> = {
  PENDING: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'PENDING', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
}

interface DeliveryStatusProps {
  value: DeliveryStatusValue
}

export class DeliveryStatus extends ValueObject<DeliveryStatusProps> {
  private constructor(props: DeliveryStatusProps) {
    super(props)
  }

  get value(): DeliveryStatusValue {
    return this.props.value
  }

  get isFinal(): boolean {
    return ALLOWED_TRANSITIONS[this.props.value].length === 0
  }

  canTransitionTo(next: DeliveryStatus): boolean {
    return ALLOWED_TRANSITIONS[this.props.value].includes(next.value)
  }

  static pending(): DeliveryStatus {
    return new DeliveryStatus({ value: 'PENDING' })
  }

  static outForDelivery(): DeliveryStatus {
    return new DeliveryStatus({ value: 'OUT_FOR_DELIVERY' })
  }

  static delivered(): DeliveryStatus {
    return new DeliveryStatus({ value: 'DELIVERED' })
  }

  static cancelled(): DeliveryStatus {
    return new DeliveryStatus({ value: 'CANCELLED' })
  }
}
