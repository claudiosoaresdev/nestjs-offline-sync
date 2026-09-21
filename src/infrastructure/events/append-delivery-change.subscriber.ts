import { Injectable } from '@nestjs/common'

import { DomainEvents } from '@/core/events/domain-events'
import { EventHandler } from '@/core/events/event-handler'
import { DeliveryChangesRepository } from '@/domain/delivery/application/repositories/delivery-changes-repository'
import { DeliveryAssignedEvent } from '@/domain/delivery/enterprise/events/delivery-assigned.event'
import { DeliveryCancelledEvent } from '@/domain/delivery/enterprise/events/delivery-cancelled.event'
import { DeliveryCreatedEvent } from '@/domain/delivery/enterprise/events/delivery-created.event'
import { DeliveryDetailsChangedEvent } from '@/domain/delivery/enterprise/events/delivery-details-changed.event'
import { DeliveryRatedEvent } from '@/domain/delivery/enterprise/events/delivery-rated.event'
import { DeliveryStatusChangedEvent } from '@/domain/delivery/enterprise/events/delivery-status-changed.event'

/**
 * Traduz evento de domínio em entrada do log de sincronização. É isto que faz
 * valer a regra de ouro do delta sync: nenhuma mudança de entrega existe sem
 * change correspondente, porque quem anuncia a mudança é o próprio agregado.
 */
@Injectable()
export class AppendDeliveryChangeSubscriber implements EventHandler {
  constructor(private readonly changes: DeliveryChangesRepository) {
    this.setupSubscriptions()
  }

  setupSubscriptions(): void {
    DomainEvents.register(
      (event: DeliveryCreatedEvent) => this.onDeliveryCreated(event),
      DeliveryCreatedEvent.name,
    )
    DomainEvents.register(
      (event: DeliveryStatusChangedEvent) => this.onStatusChanged(event),
      DeliveryStatusChangedEvent.name,
    )
    DomainEvents.register(
      (event: DeliveryDetailsChangedEvent) => this.onDetailsChanged(event),
      DeliveryDetailsChangedEvent.name,
    )
    DomainEvents.register(
      (event: DeliveryRatedEvent) => this.onRated(event),
      DeliveryRatedEvent.name,
    )
    DomainEvents.register(
      (event: DeliveryAssignedEvent) => this.onAssigned(event),
      DeliveryAssignedEvent.name,
    )
    DomainEvents.register(
      (event: DeliveryCancelledEvent) => this.onCancelled(event),
      DeliveryCancelledEvent.name,
    )
  }

  private async onDeliveryCreated(event: DeliveryCreatedEvent): Promise<void> {
    await this.changes.append({
      type: 'UPSERT',
      deliveryId: event.deliveryId,
      courierId: event.courierId,
    })
  }

  private async onStatusChanged(
    event: DeliveryStatusChangedEvent,
  ): Promise<void> {
    await this.changes.append({
      type: 'UPSERT',
      deliveryId: event.deliveryId,
      courierId: event.courierId,
    })
  }

  private async onDetailsChanged(
    event: DeliveryDetailsChangedEvent,
  ): Promise<void> {
    await this.changes.append({
      type: 'UPSERT',
      deliveryId: event.deliveryId,
      courierId: event.courierId,
    })
  }

  private async onRated(event: DeliveryRatedEvent): Promise<void> {
    await this.changes.append({
      type: 'UPSERT',
      deliveryId: event.deliveryId,
      courierId: event.courierId,
    })
  }

  private async onAssigned(event: DeliveryAssignedEvent): Promise<void> {
    if (event.previousCourierId) {
      await this.changes.append({
        type: 'REMOVE',
        deliveryId: event.deliveryId,
        courierId: event.previousCourierId,
      })
    }

    await this.changes.append({
      type: 'UPSERT',
      deliveryId: event.deliveryId,
      courierId: event.courierId,
    })
  }

  private async onCancelled(event: DeliveryCancelledEvent): Promise<void> {
    await this.changes.append({
      type: 'REMOVE',
      deliveryId: event.deliveryId,
      courierId: event.courierId,
    })
  }
}
