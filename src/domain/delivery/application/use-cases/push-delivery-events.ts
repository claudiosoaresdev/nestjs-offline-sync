import { Injectable } from '@nestjs/common'

import { Either, right } from '@/core/either'
import { DeliveriesRepository } from '@/domain/delivery/application/repositories/deliveries-repository'
import { ProcessedDeliveryEventsRepository } from '@/domain/delivery/application/repositories/processed-delivery-events-repository'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'

export type PushedDeliveryEventType =
  'OUT_FOR_DELIVERY' | 'FAILED_ATTEMPT' | 'DELIVERED'

export interface PushedDeliveryEvent {
  clientEventId: string
  deliveryId: string
  type: PushedDeliveryEventType
  occurredAt: Date
  reason?: string
  receivedBy?: string
}

export type PushDeliveryEventResultStatus = 'APPLIED' | 'DUPLICATE' | 'REJECTED'

export type PushDeliveryEventRejectionCode =
  | 'DELIVERY_NOT_FOUND'
  | 'DELIVERY_REASSIGNED'
  | 'DELIVERY_CANCELLED'
  | 'INVALID_STATUS_TRANSITION'

export interface PushDeliveryEventResult {
  clientEventId: string
  status: PushDeliveryEventResultStatus
  code?: PushDeliveryEventRejectionCode
  delivery?: Delivery
}

export interface PushDeliveryEventsUseCaseRequest {
  courierId: string
  events: PushedDeliveryEvent[]
}

export type PushDeliveryEventsUseCaseResponse = Either<
  never,
  { results: PushDeliveryEventResult[] }
>

@Injectable()
export class PushDeliveryEventsUseCase {
  constructor(
    private readonly deliveries: DeliveriesRepository,
    private readonly processed: ProcessedDeliveryEventsRepository,
  ) {}

  async execute({
    courierId,
    events,
  }: PushDeliveryEventsUseCaseRequest): Promise<PushDeliveryEventsUseCaseResponse> {
    const resultsByEventId = new Map<string, PushDeliveryEventResult>()

    for (const event of this.order(events)) {
      resultsByEventId.set(
        event.clientEventId,
        await this.applyOne(event, courierId),
      )
    }

    // A resposta sai na ordem em que o cliente enviou, para ele casar item a item.
    const results = events.map(
      (event) =>
        resultsByEventId.get(event.clientEventId) ?? {
          clientEventId: event.clientEventId,
          status: 'REJECTED' as const,
          code: 'DELIVERY_NOT_FOUND' as const,
        },
    )

    return right({ results })
  }

  /**
   * Eventos da mesma entrega são aplicados em ordem de relógio do dispositivo;
   * entregas diferentes mantêm a ordem de chegada no array.
   */
  private order(events: PushedDeliveryEvent[]): PushedDeliveryEvent[] {
    const groups = new Map<string, PushedDeliveryEvent[]>()

    for (const event of events) {
      const group = groups.get(event.deliveryId) ?? []
      group.push(event)
      groups.set(event.deliveryId, group)
    }

    return [...groups.values()].flatMap((group) =>
      [...group].sort(
        (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
      ),
    )
  }

  private async applyOne(
    event: PushedDeliveryEvent,
    courierId: string,
  ): Promise<PushDeliveryEventResult> {
    if (await this.processed.has(event.clientEventId)) {
      return { clientEventId: event.clientEventId, status: 'DUPLICATE' }
    }

    const delivery = await this.deliveries.findById(event.deliveryId)

    if (!delivery) {
      return {
        clientEventId: event.clientEventId,
        status: 'REJECTED',
        code: 'DELIVERY_NOT_FOUND',
      }
    }

    if (delivery.courierId.toString() !== courierId) {
      return {
        clientEventId: event.clientEventId,
        status: 'REJECTED',
        code: 'DELIVERY_REASSIGNED',
        delivery,
      }
    }

    if (delivery.status.value === 'CANCELLED') {
      return {
        clientEventId: event.clientEventId,
        status: 'REJECTED',
        code: 'DELIVERY_CANCELLED',
        delivery,
      }
    }

    const applied = this.applyToAggregate(delivery, event)

    if (applied.isLeft()) {
      return {
        clientEventId: event.clientEventId,
        status: 'REJECTED',
        code: 'INVALID_STATUS_TRANSITION',
        delivery,
      }
    }

    await this.deliveries.save(delivery)
    await this.processed.register(event.clientEventId)

    return { clientEventId: event.clientEventId, status: 'APPLIED', delivery }
  }

  private applyToAggregate(
    delivery: Delivery,
    event: PushedDeliveryEvent,
  ): Either<Error, null> {
    switch (event.type) {
      case 'OUT_FOR_DELIVERY':
        return delivery.markOutForDelivery(event.occurredAt)
      case 'FAILED_ATTEMPT':
        return delivery.registerFailedAttempt(
          event.reason ?? 'Não informado',
          event.occurredAt,
        )
      case 'DELIVERED':
        return delivery.markDelivered(
          event.receivedBy ?? 'Não informado',
          event.occurredAt,
        )
    }
  }
}
