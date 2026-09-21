import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common'
import { z } from 'zod'

import { RateDeliveryUseCase } from '@/domain/delivery/application/use-cases/rate-delivery'
import { useCaseErrorToHttp } from '@/infrastructure/http/controllers/errors/use-case-error-to-http'
import { DeliveryPresenter } from '@/infrastructure/http/presenters/delivery-presenter'
import { ZodValidationPipe } from '@/infrastructure/validation/zod-validation.pipe'

const rateDeliveryBodySchema = z.object({
  score: z.number().int().min(0).max(5),
  comment: z.string().max(500).nullish(),
})

type RateDeliveryBody = z.infer<typeof rateDeliveryBodySchema>

@Controller('/deliveries/:deliveryId/rating')
export class RateDeliveryController {
  constructor(private readonly rateDelivery: RateDeliveryUseCase) {}

  @Post()
  @HttpCode(201)
  async handle(
    @Param('deliveryId') deliveryId: string,
    @Body(new ZodValidationPipe(rateDeliveryBodySchema)) body: RateDeliveryBody,
  ) {
    const result = await this.rateDelivery.execute({
      deliveryId,
      score: body.score,
      comment: body.comment ?? null,
    })

    if (result.isLeft()) {
      throw useCaseErrorToHttp(result.value)
    }

    return { delivery: DeliveryPresenter.toHTTP(result.value.delivery) }
  }
}
