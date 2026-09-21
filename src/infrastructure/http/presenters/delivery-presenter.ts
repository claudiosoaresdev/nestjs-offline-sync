import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'

export class DeliveryPresenter {
  static toHTTP(delivery: Delivery) {
    return {
      id: delivery.id.toString(),
      courierId: delivery.courierId.toString(),
      status: delivery.status.value,
      attempts: delivery.attempts,
      customer: {
        name: delivery.customer.name,
        phone: delivery.customer.phone,
        address: delivery.customer.address,
      },
      items: delivery.items.map((item) => ({
        productId: item.productId.toString(),
        productName: item.productName,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity.value,
      })),
      totalCents: delivery.totalCents,
      rating: delivery.rating
        ? {
            score: delivery.rating.score.value,
            comment: delivery.rating.comment,
            ratedAt: delivery.rating.ratedAt.toISOString(),
          }
        : null,
      receivedBy: delivery.receivedBy,
      deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
      revision: delivery.revision,
      createdAt: delivery.createdAt.toISOString(),
      updatedAt: delivery.updatedAt.toISOString(),
    }
  }
}
