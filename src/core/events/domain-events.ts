import { AggregateRoot } from '@/core/entities/aggregate-root'
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvent } from '@/core/events/domain-event'

type DomainEventCallback = (event: any) => void | Promise<void>

export class DomainEvents {
  private static handlersMap: Record<string, DomainEventCallback[]> = {}
  private static markedAggregates: AggregateRoot<unknown>[] = []

  public static shouldRun = true

  static register<T extends DomainEvent>(
    callback: (event: T) => void | Promise<void>,
    eventName: string,
  ): void {
    this.handlersMap[eventName] ??= []
    this.handlersMap[eventName].push(callback as DomainEventCallback)
  }

  static markAggregateForDispatch(aggregate: AggregateRoot<unknown>): void {
    if (!this.markedAggregates.includes(aggregate)) {
      this.markedAggregates.push(aggregate)
    }
  }

  static dispatchEventsForAggregate(id: UniqueEntityID): void {
    const aggregates = this.markedAggregates.filter((aggregate) =>
      aggregate.id.equals(id),
    )

    for (const aggregate of aggregates) {
      const pendingEvents = [...aggregate.domainEvents]

      aggregate.clearEvents()
      this.removeFromMarked(aggregate)

      if (!this.shouldRun) continue

      for (const event of pendingEvents) {
        this.dispatch(event)
      }
    }
  }

  static clearHandlers(): void {
    this.handlersMap = {}
  }

  static clearMarkedAggregates(): void {
    this.markedAggregates = []
  }

  private static removeFromMarked(aggregate: AggregateRoot<unknown>): void {
    const index = this.markedAggregates.findIndex(
      (marked) => marked === aggregate,
    )

    if (index !== -1) this.markedAggregates.splice(index, 1)
  }

  private static dispatch(event: DomainEvent): void {
    const handlers = this.handlersMap[event.constructor.name]

    // `void` descarta de propósito a promise devolvida pelo handler: este
    // barramento é fire-and-forget, e tratar erro aqui exigiria decidir uma
    // política de retry que o projeto não tem. Efeito colateral: um handler
    // que rejeite perde seu efeito em silêncio, sem propagar para quem
    // disparou o evento. A garantia "nenhuma mudança de estado sem change"
    // (ver README) depende de o handler que grava o log (hoje,
    // AppendDeliveryChangeSubscriber → append) não ter caminho de falha —
    // verdade para o repositório in-memory, mas não para persistência real,
    // que precisaria de outbox ou transação para sustentar a mesma garantia.
    handlers?.forEach((handler) => void handler(event))
  }
}
