import { Injectable } from '@nestjs/common'

import { ProcessedDeliveryEventsRepository } from '@/domain/delivery/application/repositories/processed-delivery-events-repository'

@Injectable()
export class InMemoryProcessedDeliveryEventsRepository extends ProcessedDeliveryEventsRepository {
  public items = new Set<string>()

  has(clientEventId: string): Promise<boolean> {
    return Promise.resolve(this.items.has(clientEventId))
  }

  register(clientEventId: string): Promise<void> {
    this.items.add(clientEventId)

    return Promise.resolve()
  }
}
