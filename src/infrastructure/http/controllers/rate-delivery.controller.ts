import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common'
import { z } from 'zod'

import { RateDeliveryUseCase } from '@/domain/delivery/application/use-cases/rate-delivery'
import { useCaseErrorToHttp } from '@/infrastructure/http/controllers/errors/use-case-error-to-http'
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

    // Quem chama esta rota só provou conhecer o UUID da entrega, sem
    // autenticação — a resposta não pode devolver dados do cliente (nome,
    // telefone, endereço). O mínimo necessário para o app confirmar a
    // avaliação: status atual e a nota que acabou de ser registrada.
    const { delivery } = result.value

    return {
      delivery: {
        id: delivery.id.toString(),
        status: delivery.status.value,
        rating: delivery.rating
          ? {
              score: delivery.rating.score.value,
              comment: delivery.rating.comment,
              ratedAt: delivery.rating.ratedAt.toISOString(),
            }
          : null,
      },
    }
  }
}
