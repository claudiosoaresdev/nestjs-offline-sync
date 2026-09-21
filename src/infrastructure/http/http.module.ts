import { Module } from '@nestjs/common'

import { CreateDeliveryUseCase } from '@/domain/delivery/application/use-cases/create-delivery'
import { GetDeliverySnapshotUseCase } from '@/domain/delivery/application/use-cases/get-delivery-snapshot'
import { PullDeliveryChangesUseCase } from '@/domain/delivery/application/use-cases/pull-delivery-changes'
import { PushDeliveryEventsUseCase } from '@/domain/delivery/application/use-cases/push-delivery-events'
import { RateDeliveryUseCase } from '@/domain/delivery/application/use-cases/rate-delivery'
import { UpdateDeliveryUseCase } from '@/domain/delivery/application/use-cases/update-delivery'
import { DatabaseModule } from '@/infrastructure/database/database.module'
import { AppendDeliveryChangeSubscriber } from '@/infrastructure/events/append-delivery-change.subscriber'
import { CreateDeliveryController } from '@/infrastructure/http/controllers/create-delivery.controller'
import { GetDeliverySnapshotController } from '@/infrastructure/http/controllers/get-delivery-snapshot.controller'
import { PullDeliveryChangesController } from '@/infrastructure/http/controllers/pull-delivery-changes.controller'
import { PushDeliveryEventsController } from '@/infrastructure/http/controllers/push-delivery-events.controller'
import { RateDeliveryController } from '@/infrastructure/http/controllers/rate-delivery.controller'
import { UpdateDeliveryController } from '@/infrastructure/http/controllers/update-delivery.controller'

// EnvModule e LoggerModule são @Global(): seus exports (EnvService,
// LoggerService) já estão disponíveis para injeção sem reimportar aqui.
// Controllers (um por caso de uso) e use cases entram neste módulo conforme as
// features forem criadas — nunca em um módulo por bounded context.
//
// Ordem dos controllers importa: CreateDeliveryController (`POST /deliveries`)
// precisa vir antes de UpdateDeliveryController (`PATCH /deliveries/:deliveryId`),
// senão o roteamento do Nest pode casar a rota errada primeiro.
//
// AppendDeliveryChangeSubscriber é registrado uma única vez aqui como
// provider do módulo. Ver o comentário no próprio arquivo do subscriber para
// o motivo: duas instâncias duplicariam entradas no log de sincronização.
@Module({
  imports: [DatabaseModule],
  controllers: [
    CreateDeliveryController,
    UpdateDeliveryController,
    GetDeliverySnapshotController,
    PullDeliveryChangesController,
    PushDeliveryEventsController,
    RateDeliveryController,
  ],
  providers: [
    CreateDeliveryUseCase,
    UpdateDeliveryUseCase,
    GetDeliverySnapshotUseCase,
    PullDeliveryChangesUseCase,
    PushDeliveryEventsUseCase,
    RateDeliveryUseCase,
    AppendDeliveryChangeSubscriber,
  ],
})
export class HttpModule {}
