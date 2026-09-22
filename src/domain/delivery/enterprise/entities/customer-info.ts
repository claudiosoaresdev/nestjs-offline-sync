import { ValueObject } from '@/core/entities/value-object'

export interface CustomerInfoProps {
  name: string
  phone: string
  address: string
}

export class CustomerInfo extends ValueObject<CustomerInfoProps> {
  private constructor(props: CustomerInfoProps) {
    super(props)
  }

  get name(): string {
    return this.props.name
  }

  get phone(): string {
    return this.props.phone
  }

  get address(): string {
    return this.props.address
  }

  static create(props: CustomerInfoProps): CustomerInfo {
    return new CustomerInfo(props)
  }
}
