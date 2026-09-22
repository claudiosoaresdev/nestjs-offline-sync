import { Controller, Get, Param, Query } from '@nestjs/common'
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { z } from 'zod'

import { GetDeliverySnapshotUseCase } from '@/domain/delivery/application/use-cases/get-delivery-snapshot'
import { useCaseErrorToHttp } from '@/infrastructure/http/controllers/errors/use-case-error-to-http'
import { DeliveryPresenter } from '@/infrastructure/http/presenters/delivery-presenter'
import { zodValidationErrorSchema } from '@/infrastructure/swagger/zod-validation-error.schema'
import { ZodValidationPipe } from '@/infrastructure/validation/zod-validation.pipe'

const snapshotQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().uuid().optional(),
  // z.coerce.boolean() trataria a string "false" como true — daí o enum explícito.
  withTotal: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
})

type SnapshotQuery = z.infer<typeof snapshotQuerySchema>

@ApiTags('sync')
@Controller('/couriers/:courierId/deliveries/snapshot')
export class GetDeliverySnapshotController {
  constructor(private readonly getSnapshot: GetDeliverySnapshotUseCase) {}

  @Get()
  @ApiOperation({
    summary: 'Carga inicial paginada das entregas de um entregador',
    description:
      'Primeiro passo do protocolo de sincronização. O `currentVersion` devolvido ' +
      'na **primeira** página é a âncora: mudanças que ocorrerem durante a ' +
      'paginação não aparecem nas páginas seguintes, então ao terminar de paginar ' +
      '(quando `nextCursor` deixa de vir) o cliente deve chamar ' +
      'GET /couriers/{courierId}/deliveries/changes com sinceVersion = essa âncora ' +
      'para pegar o que mudou nesse meio-tempo. Pagine repetindo a chamada com ' +
      '`cursor = nextCursor` até ele deixar de vir na resposta.',
  })
  @ApiParam({
    name: 'courierId',
    description: 'Id do entregador',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Tamanho da página (1–500)',
    schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
    example: 100,
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description:
      'Id da última entrega da página anterior. Omitido na primeira chamada.',
    schema: { type: 'string', format: 'uuid' },
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  @ApiQuery({
    name: 'withTotal',
    required: false,
    description:
      'Quando "true", inclui `totalItems` na resposta (consulta extra de contagem).',
    schema: { type: 'string', enum: ['true', 'false'], default: 'false' },
    example: 'false',
  })
  @ApiResponse({
    status: 200,
    description: 'Página do snapshot',
    schema: {
      type: 'object',
      properties: {
        currentVersion: {
          type: 'integer',
          description:
            'Âncora de versão lida antes da página — use no delta seguinte.',
          example: 4200,
        },
        totalItems: {
          type: 'integer',
          nullable: true,
          description: 'Só presente quando withTotal=true.',
          example: 132,
        },
        nextCursor: {
          type: 'string',
          format: 'uuid',
          nullable: true,
          description: 'Ausente quando esta é a última página.',
          example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        },
        deliveries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              courierId: { type: 'string', format: 'uuid' },
              status: {
                type: 'string',
                enum: [
                  'PENDING',
                  'OUT_FOR_DELIVERY',
                  'DELIVERED',
                  'FAILED',
                  'CANCELLED',
                ],
                example: 'PENDING',
              },
              attempts: { type: 'integer', example: 0 },
              customer: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'Maria Oliveira' },
                  phone: { type: 'string', example: '+55 11 98888-7777' },
                  address: {
                    type: 'string',
                    example: 'Rua das Acácias, 120 — São Paulo/SP',
                  },
                },
              },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    productId: { type: 'string', format: 'uuid' },
                    productName: {
                      type: 'string',
                      example: 'Caixa de parafusos M6',
                    },
                    unitPriceCents: { type: 'integer', example: 1990 },
                    quantity: { type: 'integer', example: 3 },
                  },
                },
              },
              totalCents: { type: 'integer', example: 5970 },
              rating: { type: 'object', nullable: true },
              receivedBy: { type: 'string', nullable: true, example: null },
              deliveredAt: {
                type: 'string',
                format: 'date-time',
                nullable: true,
              },
              revision: { type: 'integer', example: 1 },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 422,
    description:
      'Query inválida (Zod) — ex.: cursor que não é UUID, limit fora de 1–500.',
    schema: zodValidationErrorSchema,
  })
  async handle(
    @Param('courierId') courierId: string,
    @Query(new ZodValidationPipe(snapshotQuerySchema)) query: SnapshotQuery,
  ) {
    const result = await this.getSnapshot.execute({ courierId, ...query })

    if (result.isLeft()) {
      throw useCaseErrorToHttp(result.value)
    }

    return {
      currentVersion: result.value.currentVersion,
      totalItems: result.value.totalItems,
      nextCursor: result.value.nextCursor,
      deliveries: result.value.deliveries.map((delivery) =>
        DeliveryPresenter.toHTTP(delivery),
      ),
    }
  }
}
