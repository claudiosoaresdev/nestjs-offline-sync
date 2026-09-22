import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common'
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { z } from 'zod'

import { RateDeliveryUseCase } from '@/domain/delivery/application/use-cases/rate-delivery'
import { useCaseErrorToHttp } from '@/infrastructure/http/controllers/errors/use-case-error-to-http'
import { zodValidationErrorSchema } from '@/infrastructure/swagger/zod-validation-error.schema'
import { ZodValidationPipe } from '@/infrastructure/validation/zod-validation.pipe'

const rateDeliveryBodySchema = z.object({
  score: z.number().int().min(0).max(5),
  comment: z.string().max(500).nullish(),
})

type RateDeliveryBody = z.infer<typeof rateDeliveryBodySchema>

@ApiTags('deliveries')
@Controller('/deliveries/:deliveryId/rating')
export class RateDeliveryController {
  constructor(private readonly rateDelivery: RateDeliveryUseCase) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Destinatário avalia uma entrega concluída',
    description:
      'Fecha o ciclo do protocolo: só pode avaliar uma entrega em status ' +
      'DELIVERED, e só uma vez. A avaliação emite change de domínio e aparece no ' +
      'próximo delta do entregador. Esta rota é acessada só com o UUID da entrega ' +
      '(sem autenticação), por isso a resposta é deliberadamente mínima — id, ' +
      'status e a nota registrada — e nunca inclui dados do cliente (nome, ' +
      'telefone, endereço).',
  })
  @ApiParam({
    name: 'deliveryId',
    description: 'Id da entrega',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['score'],
      properties: {
        score: {
          type: 'integer',
          minimum: 0,
          maximum: 5,
          description: 'Nota inteira de 0 a 5.',
          example: 5,
        },
        comment: {
          type: 'string',
          maxLength: 500,
          nullable: true,
          example: 'Entrega rápida e entregador educado.',
        },
      },
      example: { score: 5, comment: 'Entrega rápida e entregador educado.' },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Avaliação registrada',
    schema: {
      type: 'object',
      properties: {
        delivery: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            status: { type: 'string', example: 'DELIVERED' },
            rating: {
              type: 'object',
              nullable: true,
              properties: {
                score: { type: 'integer', example: 5 },
                comment: {
                  type: 'string',
                  nullable: true,
                  example: 'Entrega rápida e entregador educado.',
                },
                ratedAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'RESOURCE_NOT_FOUND — a entrega não existe.',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'RESOURCE_NOT_FOUND' },
        message: { type: 'string', example: 'Delivery not found' },
      },
    },
  })
  @ApiResponse({
    status: 409,
    description:
      'DELIVERY_NOT_DELIVERED — a entrega ainda não está DELIVERED; ou ' +
      'RATING_ALREADY_EXISTS — a entrega já foi avaliada.',
    schema: {
      oneOf: [
        {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'DELIVERY_NOT_DELIVERED' },
            message: {
              type: 'string',
              example: 'Only delivered deliveries can be rated',
            },
          },
        },
        {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'RATING_ALREADY_EXISTS' },
            message: {
              type: 'string',
              example: 'Delivery has already been rated',
            },
          },
        },
      ],
    },
  })
  @ApiResponse({
    status: 422,
    description:
      'Corpo inválido (Zod); ou INVALID_RATING_SCORE — nota fora de 0–5 (checagem ' +
      'redundante no domínio, além da validação de borda pelo Zod).',
    schema: {
      oneOf: [
        zodValidationErrorSchema,
        {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'INVALID_RATING_SCORE' },
            message: {
              type: 'string',
              example:
                'Invalid rating score: 7. Expected an integer between 0 and 5',
            },
          },
        },
      ],
    },
  })
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
