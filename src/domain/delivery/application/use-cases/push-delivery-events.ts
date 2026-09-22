import { Injectable } from '@nestjs/common'

import { Either, right } from '@/core/either'
import { DeliveriesRepository } from '@/domain/delivery/application/repositories/deliveries-repository'
import { ProcessedDeliveryEventsRepository } from '@/domain/delivery/application/repositories/processed-delivery-events-repository'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'

const UNSPECIFIED = 'Não informado'

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
    const indexed = events.map((event, index) => ({ event, index }))
    const results: PushDeliveryEventResult[] =
      new Array<PushDeliveryEventResult>(events.length)

    // A resposta é indexada pela posição do evento no array original, e não
    // pelo clientEventId: o mesmo id pode aparecer duas vezes num lote (a
    // segunda ocorrência é DUPLICATE), e cada posição precisa do seu próprio
    // resultado — chavear por id colapsaria as duas num único resultado.
    for (const { event, index } of this.order(indexed)) {
      results[index] = await this.applyOne(event, courierId)
    }

    return right({ results })
  }

  /**
   * Eventos da mesma entrega são aplicados em ordem de relógio do dispositivo;
   * entregas diferentes mantêm a ordem de chegada no array.
   */
  private order(
    indexed: { event: PushedDeliveryEvent; index: number }[],
  ): { event: PushedDeliveryEvent; index: number }[] {
    const groups = new Map<
      string,
      { event: PushedDeliveryEvent; index: number }[]
    >()

    for (const item of indexed) {
      const group = groups.get(item.event.deliveryId) ?? []
      group.push(item)
      groups.set(item.event.deliveryId, group)
    }

    return [...groups.values()].flatMap((group) =>
      [...group].sort(
        (a, b) => a.event.occurredAt.getTime() - b.event.occurredAt.getTime(),
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

    // save + register não são atômicos aqui. Em memória não há caminho de
    // falha entre os dois, mas com um banco real eles precisam da mesma
    // transação: se register falhasse após o save, o reenvio não bateria
    // mais em DUPLICATE e cairia em INVALID_STATUS_TRANSITION contra o
    // estado já alterado.
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
          event.reason ?? UNSPECIFIED,
          event.occurredAt,
        )
      case 'DELIVERED':
        return delivery.markDelivered(
          event.receivedBy ?? UNSPECIFIED,
          event.occurredAt,
        )
    }
  }
}
