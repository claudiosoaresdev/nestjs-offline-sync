import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common'
import { z } from 'zod'

import { PushDeliveryEventsUseCase } from '@/domain/delivery/application/use-cases/push-delivery-events'
import { useCaseErrorToHttp } from '@/infrastructure/http/controllers/errors/use-case-error-to-http'
import { DeliveryPresenter } from '@/infrastructure/http/presenters/delivery-presenter'
import { ZodValidationPipe } from '@/infrastructure/validation/zod-validation.pipe'

const pushEventsBodySchema = z.object({
  events: z
    .array(
      z.object({
        clientEventId: z.string().uuid(),
        deliveryId: z.string().uuid(),
        type: z.enum(['OUT_FOR_DELIVERY', 'FAILED_ATTEMPT', 'DELIVERED']),
        occurredAt: z.coerce.date(),
        reason: z.string().max(200).optional(),
        receivedBy: z.string().max(120).optional(),
      }),
    )
    .min(1)
    .max(200),
})

type PushEventsBody = z.infer<typeof pushEventsBodySchema>

@Controller('/couriers/:courierId/deliveries/events')
export class PushDeliveryEventsController {
  constructor(private readonly pushEvents: PushDeliveryEventsUseCase) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Param('courierId') courierId: string,
    @Body(new ZodValidationPipe(pushEventsBodySchema)) body: PushEventsBody,
  ) {
    const result = await this.pushEvents.execute({
      courierId,
      events: body.events,
    })

    if (result.isLeft()) {
      throw useCaseErrorToHttp(result.value)
    }

    return {
      results: result.value.results.map((item) => ({
        clientEventId: item.clientEventId,
        status: item.status,
        code: item.code,
        delivery: item.delivery
          ? DeliveryPresenter.toHTTP(item.delivery)
          : undefined,
      })),
    }
  }
}
