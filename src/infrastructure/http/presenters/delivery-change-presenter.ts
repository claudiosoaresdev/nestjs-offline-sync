import { DeliveryChangeView } from '@/domain/delivery/application/use-cases/pull-delivery-changes'
import { DeliveryPresenter } from '@/infrastructure/http/presenters/delivery-presenter'

export class DeliveryChangePresenter {
  static toHTTP(change: DeliveryChangeView) {
    return {
      type: change.type,
      version: change.version,
      deliveryId: change.deliveryId,
      delivery: change.delivery
        ? DeliveryPresenter.toHTTP(change.delivery)
        : undefined,
    }
  }
}
