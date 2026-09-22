export abstract class ProcessedDeliveryEventsRepository {
  abstract has(clientEventId: string): Promise<boolean>
  abstract register(clientEventId: string): Promise<void>
}
