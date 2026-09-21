import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AggregateRoot } from '@/core/entities/aggregate-root'
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvent } from '@/core/events/domain-event'
import { DomainEvents } from '@/core/events/domain-events'

class DummyEvent implements DomainEvent {
  public readonly occurredAt = new Date()

  constructor(private readonly aggregateId: UniqueEntityID) {}

  getAggregateId(): UniqueEntityID {
    return this.aggregateId
  }
}

class DummyAggregate extends AggregateRoot<{ touched: boolean }> {
  static create() {
    return new DummyAggregate({ touched: false })
  }

  touch() {
    this.props.touched = true
    this.addDomainEvent(new DummyEvent(this.id))
  }
}

describe('DomainEvents', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()
    DomainEvents.shouldRun = true
  })

  it('acumula no agregado e só despacha no dispatchEventsForAggregate', () => {
    const handler = vi.fn()
    DomainEvents.register(handler, DummyEvent.name)

    const aggregate = DummyAggregate.create()
    aggregate.touch()

    expect(aggregate.domainEvents).toHaveLength(1)
    expect(handler).not.toHaveBeenCalled()

    DomainEvents.dispatchEventsForAggregate(aggregate.id)

    expect(handler).toHaveBeenCalledOnce()
    expect(aggregate.domainEvents).toHaveLength(0)
  })

  it('não executa handler com shouldRun desligado, mas limpa os eventos', () => {
    const handler = vi.fn()
    DomainEvents.register(handler, DummyEvent.name)
    DomainEvents.shouldRun = false

    const aggregate = DummyAggregate.create()
    aggregate.touch()

    DomainEvents.dispatchEventsForAggregate(aggregate.id)

    expect(handler).not.toHaveBeenCalled()
    expect(aggregate.domainEvents).toHaveLength(0)
  })

  it('ignora agregado com id diferente', () => {
    const handler = vi.fn()
    DomainEvents.register(handler, DummyEvent.name)

    const aggregate = DummyAggregate.create()
    aggregate.touch()

    DomainEvents.dispatchEventsForAggregate(new UniqueEntityID())

    expect(handler).not.toHaveBeenCalled()
    expect(aggregate.domainEvents).toHaveLength(1)
  })
})
