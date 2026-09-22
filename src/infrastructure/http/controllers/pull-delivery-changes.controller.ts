import { Controller, Get, Param, Query } from '@nestjs/common'
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { z } from 'zod'

import { PullDeliveryChangesUseCase } from '@/domain/delivery/application/use-cases/pull-delivery-changes'
import { useCaseErrorToHttp } from '@/infrastructure/http/controllers/errors/use-case-error-to-http'
import { DeliveryChangePresenter } from '@/infrastructure/http/presenters/delivery-change-presenter'
import { zodValidationErrorSchema } from '@/infrastructure/swagger/zod-validation-error.schema'
import { ZodValidationPipe } from '@/infrastructure/validation/zod-validation.pipe'

const changesQuerySchema = z.object({
  sinceVersion: z.coerce.number().int().min(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

type ChangesQuery = z.infer<typeof changesQuerySchema>

@ApiTags('sync')
@Controller('/couriers/:courierId/deliveries/changes')
export class PullDeliveryChangesController {
  constructor(private readonly pullChanges: PullDeliveryChangesUseCase) {}

  @Get()
  @ApiOperation({
    summary: 'Delta de mudanças desde a última sincronização',
    description:
      'Depois do snapshot inicial, o cliente convence o cache local chamando esta ' +
      'rota em loop: envie `sinceVersion` (a âncora do snapshot, ou o `nextVersion` ' +
      'da última chamada), aplique `changes`, avance o cursor local para ' +
      '`nextVersion` — **nunca** para `currentVersion`, esse é o bug que este ' +
      'protocolo corrige — e repita enquanto `hasMore` for true. Se ' +
      '`resyncRequired` vier true (cursor mais velho que `minVersion`, log podado, ' +
      'ou mais adiantado que `currentVersion`, ex.: restore de backup), descarte o ' +
      'cursor e refaça o snapshot em GET /couriers/{courierId}/deliveries/snapshot ' +
      '— não há como convergir por delta nesses casos. Cada entrada de `changes` é ' +
      'UPSERT (estado atual da entrega) ou REMOVE (a entrega saiu da carteira do ' +
      'entregador — cancelada ou reatribuída a outro courier — não é exclusão do ' +
      'registro). O lote vem compactado por entrega: várias mudanças da mesma ' +
      'entrega chegam como uma única entrada com o estado final.',
  })
  @ApiParam({
    name: 'courierId',
    description: 'Id do entregador',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiQuery({
    name: 'sinceVersion',
    required: true,
    description:
      'Versão a partir da qual buscar mudanças (exclusive) — a âncora do snapshot ' +
      'ou o nextVersion da chamada anterior.',
    schema: { type: 'integer', minimum: 0 },
    example: 3200,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description:
      'Teto de linhas brutas lidas do log de mudanças (1–500). Não é o tamanho ' +
      'final de `changes` — a compactação por entrega pode encolher o lote.',
    schema: { type: 'integer', minimum: 1, maximum: 500, default: 200 },
    example: 200,
  })
  @ApiResponse({
    status: 200,
    description: 'Lote de mudanças (eventualmente vazio)',
    schema: {
      type: 'object',
      properties: {
        currentVersion: {
          type: 'integer',
          description: 'Versão mais recente do log no momento da chamada.',
          example: 4200,
        },
        nextVersion: {
          type: 'integer',
          description:
            'Maior versão deste lote. Avance o cursor local para cá — nunca para ' +
            'currentVersion.',
          example: 3500,
        },
        hasMore: {
          type: 'boolean',
          description: 'true se ainda houver mudanças acima de nextVersion.',
          example: true,
        },
        minVersion: {
          type: 'integer',
          description: 'Piso de retenção do log de mudanças.',
          example: 0,
        },
        resyncRequired: {
          type: 'boolean',
          description:
            'true quando o cursor está fora do intervalo retido — refaça o snapshot.',
          example: false,
        },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['UPSERT', 'REMOVE'],
                example: 'UPSERT',
              },
              version: { type: 'integer', example: 3498 },
              deliveryId: { type: 'string', format: 'uuid' },
              delivery: {
                type: 'object',
                nullable: true,
                description: 'Presente apenas quando type=UPSERT.',
              },
            },
          },
          example: [
            {
              type: 'UPSERT',
              version: 3498,
              deliveryId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
              delivery: {
                id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
                status: 'OUT_FOR_DELIVERY',
              },
            },
            {
              type: 'REMOVE',
              version: 3500,
              deliveryId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
            },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 422,
    description:
      'Query inválida (Zod) — ex.: sinceVersion ausente ou negativo.',
    schema: zodValidationErrorSchema,
  })
  async handle(
    @Param('courierId') courierId: string,
    @Query(new ZodValidationPipe(changesQuerySchema)) query: ChangesQuery,
  ) {
    const result = await this.pullChanges.execute({ courierId, ...query })

    if (result.isLeft()) {
      throw useCaseErrorToHttp(result.value)
    }

    const { currentVersion, nextVersion, hasMore, minVersion, resyncRequired } =
      result.value

    return {
      currentVersion,
      nextVersion,
      hasMore,
      minVersion,
      resyncRequired,
      changes: result.value.changes.map((change) =>
        DeliveryChangePresenter.toHTTP(change),
      ),
    }
  }
}
