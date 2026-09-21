import { Either, left, right } from '@/core/either'
import { AggregateRoot } from '@/core/entities/aggregate-root'
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { Optional } from '@/core/types/optional'
import { DeliveryAlreadyFinalizedError } from '@/domain/delivery/application/use-cases/delivery-already-finalized-error'
import { DeliveryNotDeliveredError } from '@/domain/delivery/application/use-cases/delivery-not-delivered-error'
import { InvalidStatusTransitionError } from '@/domain/delivery/application/use-cases/invalid-status-transition-error'
import { RatingAlreadyExistsError } from '@/domain/delivery/application/use-cases/rating-already-exists-error'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { DeliveryItem } from '@/domain/delivery/enterprise/entities/delivery-item'
import { DeliveryStatus } from '@/domain/delivery/enterprise/entities/delivery-status'
import { RatingScore } from '@/domain/delivery/enterprise/entities/rating-score'
import { DeliveryAssignedEvent } from '@/domain/delivery/enterprise/events/delivery-assigned.event'
import { DeliveryCancelledEvent } from '@/domain/delivery/enterprise/events/delivery-cancelled.event'
import { DeliveryCreatedEvent } from '@/domain/delivery/enterprise/events/delivery-created.event'
import { DeliveryDetailsChangedEvent } from '@/domain/delivery/enterprise/events/delivery-details-changed.event'
import { DeliveryRatedEvent } from '@/domain/delivery/enterprise/events/delivery-rated.event'
import { DeliveryStatusChangedEvent } from '@/domain/delivery/enterprise/events/delivery-status-changed.event'

export interface DeliveryRating {
  score: RatingScore
  comment: string | null
  ratedAt: Date
}

export interface DeliveryProps {
  courierId: UniqueEntityID
  customer: CustomerInfo
  items: DeliveryItem[]
  status: DeliveryStatus
  attempts: number
  rating: DeliveryRating | null
  receivedBy: string | null
  deliveredAt: Date | null
  cancelReason: string | null
  lastFailureReason: string | null
  revision: number
  createdAt: Date
  updatedAt: Date
}

type CreateDeliveryProps = Optional<
  DeliveryProps,
  | 'status'
  | 'attempts'
  | 'rating'
  | 'receivedBy'
  | 'deliveredAt'
  | 'cancelReason'
  | 'lastFailureReason'
  | 'revision'
  | 'createdAt'
  | 'updatedAt'
>

export class Delivery extends AggregateRoot<DeliveryProps> {
  get courierId(): UniqueEntityID {
    return this.props.courierId
  }

  get customer(): CustomerInfo {
    return this.props.customer
  }

  get items(): readonly DeliveryItem[] {
    return this.props.items
  }

  get status(): DeliveryStatus {
    return this.props.status
  }

  get attempts(): number {
    return this.props.attempts
  }

  get rating(): DeliveryRating | null {
    return this.props.rating
  }

  get receivedBy(): string | null {
    return this.props.receivedBy
  }

  get deliveredAt(): Date | null {
    return this.props.deliveredAt
  }

  get cancelReason(): string | null {
    return this.props.cancelReason
  }

  get lastFailureReason(): string | null {
    return this.props.lastFailureReason
  }

  get revision(): number {
    return this.props.revision
  }

  get createdAt(): Date {
    return this.props.createdAt
  }

  get updatedAt(): Date {
    return this.props.updatedAt
  }

  get totalCents(): number {
    return this.props.items.reduce(
      (total, item) => total + item.subtotalCents,
      0,
    )
  }

  assignTo(
    courierId: UniqueEntityID,
  ): Either<DeliveryAlreadyFinalizedError, null> {
    if (this.props.status.isFinal) {
      return left(new DeliveryAlreadyFinalizedError())
    }

    if (this.props.courierId.equals(courierId)) {
      return right(null)
    }

    const previousCourierId = this.props.courierId

    this.props.courierId = courierId
    this.touch()
    this.addDomainEvent(
      new DeliveryAssignedEvent(this.id, courierId, previousCourierId),
    )

    return right(null)
  }

  markOutForDelivery(
    occurredAt: Date = new Date(),
  ): Either<InvalidStatusTransitionError, null> {
    return this.transitionTo(DeliveryStatus.outForDelivery(), occurredAt)
  }

  markDelivered(
    receivedBy: string,
    occurredAt: Date,
  ): Either<InvalidStatusTransitionError, null> {
    const result = this.transitionTo(DeliveryStatus.delivered(), occurredAt)

    if (result.isLeft()) {
      return result
    }

    this.props.receivedBy = receivedBy
    this.props.deliveredAt = occurredAt

    return right(null)
  }

  registerFailedAttempt(
    reason: string,
    occurredAt: Date,
  ): Either<InvalidStatusTransitionError, null> {
    const result = this.transitionTo(DeliveryStatus.pending(), occurredAt)

    if (result.isLeft()) {
      return result
    }

    this.props.attempts += 1
    this.props.lastFailureReason = reason

    return right(null)
  }

  cancel(reason: string): Either<InvalidStatusTransitionError, null> {
    const result = this.transitionTo(DeliveryStatus.cancelled(), new Date())

    if (result.isLeft()) {
      return result
    }

    this.props.cancelReason = reason
    this.addDomainEvent(
      new DeliveryCancelledEvent(this.id, this.props.courierId, reason),
    )

    return right(null)
  }

  changeItems(
    items: DeliveryItem[],
  ): Either<DeliveryAlreadyFinalizedError, null> {
    if (this.props.status.isFinal) {
      return left(new DeliveryAlreadyFinalizedError())
    }

    this.props.items = items
    this.touch()
    this.addDomainEvent(
      new DeliveryDetailsChangedEvent(this.id, this.props.courierId),
    )

    return right(null)
  }

  changeCustomer(
    customer: CustomerInfo,
  ): Either<DeliveryAlreadyFinalizedError, null> {
    if (this.props.status.isFinal) {
      return left(new DeliveryAlreadyFinalizedError())
    }

    if (this.props.customer.equals(customer)) {
      return right(null)
    }

    this.props.customer = customer
    this.touch()
    this.addDomainEvent(
      new DeliveryDetailsChangedEvent(this.id, this.props.courierId),
    )

    return right(null)
  }

  rate(
    score: RatingScore,
    comment: string | null,
  ): Either<DeliveryNotDeliveredError | RatingAlreadyExistsError, null> {
    if (this.props.status.value !== 'DELIVERED') {
      return left(new DeliveryNotDeliveredError())
    }

    if (this.props.rating) {
      return left(new RatingAlreadyExistsError())
    }

    this.props.rating = { score, comment, ratedAt: new Date() }
    this.touch()
    this.addDomainEvent(
      new DeliveryRatedEvent(this.id, this.props.courierId, score.value),
    )

    return right(null)
  }

  private transitionTo(
    next: DeliveryStatus,
    occurredAt: Date,
  ): Either<InvalidStatusTransitionError, null> {
    if (!this.props.status.canTransitionTo(next)) {
      return left(
        new InvalidStatusTransitionError(this.props.status.value, next.value),
      )
    }

    this.props.status = next
    this.touch(occurredAt)
    this.addDomainEvent(
      new DeliveryStatusChangedEvent(this.id, this.props.courierId, next.value),
    )

    return right(null)
  }

  private touch(at: Date = new Date()): void {
    this.props.updatedAt = at
    this.props.revision += 1
  }

  static create(props: CreateDeliveryProps, id?: UniqueEntityID): Delivery {
    const now = new Date()

    const delivery = new Delivery(
      {
        ...props,
        status: props.status ?? DeliveryStatus.pending(),
        attempts: props.attempts ?? 0,
        rating: props.rating ?? null,
        receivedBy: props.receivedBy ?? null,
        deliveredAt: props.deliveredAt ?? null,
        cancelReason: props.cancelReason ?? null,
        lastFailureReason: props.lastFailureReason ?? null,
        revision: props.revision ?? 0,
        createdAt: props.createdAt ?? now,
        updatedAt: props.updatedAt ?? now,
      },
      id,
    )

    if (!id) {
      delivery.addDomainEvent(
        new DeliveryCreatedEvent(delivery.id, delivery.courierId),
      )
    }

    return delivery
  }
}
