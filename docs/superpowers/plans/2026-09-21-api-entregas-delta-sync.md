# API de Entregas com Delta Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir a API offline-first de entregas e qualificação de entrega especificada em `docs/superpowers/specs/2026-09-21-api-entregas-delta-sync-design.md`, com protocolo de snapshot + delta sync correto e escrita offline idempotente.

**Architecture:** DDD + Clean Architecture sobre o scaffold existente. O bounded context `delivery` vive em `src/domain/delivery/` (TypeScript puro, sem Nest); persistência é in-memory em `src/infrastructure/database/in-memory/`; controllers e use cases são registrados no `HttpModule`, bindings de repositório no `DatabaseModule` (`@Global`). O agregado `Delivery` emite Domain Events, o repositório despacha pós-save e um subscriber traduz cada evento numa entrada do log de mudanças — é isso que garante que nenhuma mudança escape do delta sync.

**Tech Stack:** NestJS 11, TypeScript, Zod, Vitest, ESLint/Prettier, Husky + commitlint. Sem banco: repositórios in-memory.

---

## Convenções obrigatórias

Estas regras valem para **todos** os arquivos criados neste plano. O lint quebra se forem violadas.

1. **Sem ponto e vírgula** no fim das linhas (`prettier.config.mjs` tem `semi: false`), aspas simples, vírgula final.
2. **Sem import relativo.** O ESLint proíbe `./` e `../`. Todo import usa o alias `@/`, ex.: `import { Either } from '@/core/either'`.
3. **Imports ordenados** por `simple-import-sort`: side-effect → `node:` → pacotes externos → `@/` → relativos. Rodar `npm run lint` antes de cada commit resolve automaticamente.
4. **Domínio sem Nest**, exceto `@Injectable()` nos use cases. `src/domain/` nunca importa `@/infrastructure/*` — há teste de arquitetura verificando isso.
5. **Erros de negócio nunca são exceção**: use case retorna `Either<DomainError, Success>`.
6. **Commits em Conventional Commits** com tipo minúsculo e assunto sem ponto final (`commitlint.config.mjs`).
7. Antes de cada commit rodar `npm run lint && npm test`. O hook de pre-commit roda `lint-staged` + `npm run lint`.

## Estrutura de arquivos

**Domínio** (`src/domain/delivery/`)

| Arquivo                                  | Responsabilidade                               |
| ---------------------------------------- | ---------------------------------------------- |
| `enterprise/entities/delivery-status.ts` | VO do status + tabela de transições permitidas |
| `enterprise/entities/rating-score.ts`    | VO da nota 0–5                                 |
| `enterprise/entities/quantity.ts`        | VO de quantidade inteira positiva              |
| `enterprise/entities/customer-info.ts`   | VO com nome, telefone e endereço do cliente    |
| `enterprise/entities/product.ts`         | Entidade de produto pré-cadastrado             |
| `enterprise/entities/delivery-item.ts`   | Item da entrega com snapshot de nome e preço   |
| `enterprise/entities/delivery.ts`        | Agregado raiz com a máquina de estados         |
| `enterprise/entities/delivery-change.ts` | Entrada do log de sincronização                |
| `enterprise/events/*.event.ts`           | Seis eventos de domínio                        |
| `application/repositories/*.ts`          | Cinco contratos abstratos                      |
| `application/use-cases/*.ts`             | Seis use cases + erros tipados                 |

**Infraestrutura** (`src/infrastructure/`)

| Arquivo                                       | Responsabilidade                                             |
| --------------------------------------------- | ------------------------------------------------------------ |
| `database/in-memory/in-memory-*.ts`           | Uma implementação por contrato                               |
| `events/append-delivery-change.subscriber.ts` | Traduz evento de domínio em entrada do log                   |
| `http/controllers/*.controller.ts`            | Um controller por caso de uso                                |
| `http/presenters/delivery-presenter.ts`       | Entidade → JSON de resposta                                  |
| `http/errors/use-case-error-to-http.ts`       | **Modificar**: registrar os erros novos                      |
| `http/http.module.ts`                         | **Modificar**: registrar controllers, use cases e subscriber |
| `database/database.module.ts`                 | **Modificar**: registrar os bindings de repositório          |

**Testes**

| Arquivo                                   | Responsabilidade                 |
| ----------------------------------------- | -------------------------------- |
| `src/**/*.spec.ts`                        | Unit, ao lado do arquivo testado |
| `test/sync-protocol/delta-sync.spec.ts`   | Os 9 cenários do protocolo       |
| `test/e2e/delivery-lifecycle.e2e-spec.ts` | Ciclo completo via HTTP          |

**Adição ao spec:** o spec lista quatro repositórios; a idempotência do push exige um quinto, `ProcessedDeliveryEventsRepository`, para guardar os `clientEventId` já aplicados. Também entra um erro `InvalidQuantityError` (422, `INVALID_QUANTITY`), não previsto na tabela de erros do spec.

---

### Task 1: VO `DeliveryStatus`

**Files:**

- Create: `src/domain/delivery/enterprise/entities/delivery-status.ts`
- Test: `src/domain/delivery/enterprise/entities/delivery-status.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'

import { DeliveryStatus } from '@/domain/delivery/enterprise/entities/delivery-status'

describe('DeliveryStatus', () => {
  it('nasce em PENDING pela fábrica inicial', () => {
    expect(DeliveryStatus.pending().value).toBe('PENDING')
  })

  it('permite PENDING -> OUT_FOR_DELIVERY', () => {
    expect(
      DeliveryStatus.pending().canTransitionTo(DeliveryStatus.outForDelivery()),
    ).toBe(true)
  })

  it('permite OUT_FOR_DELIVERY -> PENDING (reentrega)', () => {
    expect(
      DeliveryStatus.outForDelivery().canTransitionTo(DeliveryStatus.pending()),
    ).toBe(true)
  })

  it('recusa PENDING -> DELIVERED', () => {
    expect(
      DeliveryStatus.pending().canTransitionTo(DeliveryStatus.delivered()),
    ).toBe(false)
  })

  it('trata DELIVERED e CANCELLED como terminais', () => {
    expect(DeliveryStatus.delivered().isFinal).toBe(true)
    expect(DeliveryStatus.cancelled().isFinal).toBe(true)
    expect(DeliveryStatus.pending().isFinal).toBe(false)
  })

  it('compara por valor', () => {
    expect(DeliveryStatus.pending().equals(DeliveryStatus.pending())).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/delivery/enterprise/entities/delivery-status.spec.ts`
Expected: FAIL — `Failed to resolve import "@/domain/delivery/enterprise/entities/delivery-status"`

- [ ] **Step 3: Write minimal implementation**

```ts
import { ValueObject } from '@/core/entities/value-object'

export const DELIVERY_STATUSES = [
  'PENDING',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
] as const

export type DeliveryStatusValue = (typeof DELIVERY_STATUSES)[number]

const ALLOWED_TRANSITIONS: Record<
  DeliveryStatusValue,
  readonly DeliveryStatusValue[]
> = {
  PENDING: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'PENDING', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
}

interface DeliveryStatusProps {
  value: DeliveryStatusValue
}

export class DeliveryStatus extends ValueObject<DeliveryStatusProps> {
  private constructor(props: DeliveryStatusProps) {
    super(props)
  }

  get value(): DeliveryStatusValue {
    return this.props.value
  }

  get isFinal(): boolean {
    return ALLOWED_TRANSITIONS[this.props.value].length === 0
  }

  canTransitionTo(next: DeliveryStatus): boolean {
    return ALLOWED_TRANSITIONS[this.props.value].includes(next.value)
  }

  static pending(): DeliveryStatus {
    return new DeliveryStatus({ value: 'PENDING' })
  }

  static outForDelivery(): DeliveryStatus {
    return new DeliveryStatus({ value: 'OUT_FOR_DELIVERY' })
  }

  static delivered(): DeliveryStatus {
    return new DeliveryStatus({ value: 'DELIVERED' })
  }

  static cancelled(): DeliveryStatus {
    return new DeliveryStatus({ value: 'CANCELLED' })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/delivery/enterprise/entities/delivery-status.spec.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test
git add src/domain/delivery/enterprise/entities/delivery-status.ts src/domain/delivery/enterprise/entities/delivery-status.spec.ts
git commit -m "feat(delivery): add delivery status value object"
```

---

### Task 2: VOs `RatingScore` e `Quantity`

**Files:**

- Create: `src/domain/delivery/enterprise/entities/rating-score.ts`
- Create: `src/domain/delivery/enterprise/entities/quantity.ts`
- Create: `src/domain/delivery/application/use-cases/invalid-rating-score-error.ts`
- Create: `src/domain/delivery/application/use-cases/invalid-quantity-error.ts`
- Test: `src/domain/delivery/enterprise/entities/rating-score.spec.ts`
- Test: `src/domain/delivery/enterprise/entities/quantity.spec.ts`

- [ ] **Step 1: Write the failing tests**

`rating-score.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { InvalidRatingScoreError } from '@/domain/delivery/application/use-cases/invalid-rating-score-error'
import { RatingScore } from '@/domain/delivery/enterprise/entities/rating-score'

describe('RatingScore', () => {
  it.each([0, 3, 5])('aceita a nota %i', (raw) => {
    const result = RatingScore.create(raw)

    expect(result.isRight()).toBe(true)
    expect(result.isRight() && result.value.value).toBe(raw)
  })

  it.each([-1, 6, 3.5, Number.NaN])('recusa a nota %s', (raw) => {
    const result = RatingScore.create(raw)

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(InvalidRatingScoreError)
  })

  it('compara por valor', () => {
    const a = RatingScore.create(4)
    const b = RatingScore.create(4)

    expect(a.isRight() && b.isRight() && a.value.equals(b.value)).toBe(true)
  })
})
```

`quantity.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { InvalidQuantityError } from '@/domain/delivery/application/use-cases/invalid-quantity-error'
import { Quantity } from '@/domain/delivery/enterprise/entities/quantity'

describe('Quantity', () => {
  it('aceita inteiro positivo', () => {
    const result = Quantity.create(2)

    expect(result.isRight() && result.value.value).toBe(2)
  })

  it.each([0, -1, 1.5])('recusa %s', (raw) => {
    const result = Quantity.create(raw)

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(InvalidQuantityError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/domain/delivery/enterprise/entities/rating-score.spec.ts src/domain/delivery/enterprise/entities/quantity.spec.ts`
Expected: FAIL — imports não resolvidos

- [ ] **Step 3: Write minimal implementation**

`invalid-rating-score-error.ts`:

```ts
import { UseCaseError } from '@/core/errors/use-case-error'

export class InvalidRatingScoreError extends Error implements UseCaseError {
  constructor(raw: number) {
    super(`Invalid rating score: ${raw}. Expected an integer between 0 and 5`)
  }
}
```

`invalid-quantity-error.ts`:

```ts
import { UseCaseError } from '@/core/errors/use-case-error'

export class InvalidQuantityError extends Error implements UseCaseError {
  constructor(raw: number) {
    super(`Invalid quantity: ${raw}. Expected a positive integer`)
  }
}
```

`rating-score.ts`:

```ts
import { Either, left, right } from '@/core/either'
import { ValueObject } from '@/core/entities/value-object'
import { InvalidRatingScoreError } from '@/domain/delivery/application/use-cases/invalid-rating-score-error'

const MIN_SCORE = 0
const MAX_SCORE = 5

interface RatingScoreProps {
  value: number
}

export class RatingScore extends ValueObject<RatingScoreProps> {
  private constructor(props: RatingScoreProps) {
    super(props)
  }

  get value(): number {
    return this.props.value
  }

  static create(raw: number): Either<InvalidRatingScoreError, RatingScore> {
    if (!Number.isInteger(raw) || raw < MIN_SCORE || raw > MAX_SCORE) {
      return left(new InvalidRatingScoreError(raw))
    }

    return right(new RatingScore({ value: raw }))
  }
}
```

`quantity.ts`:

```ts
import { Either, left, right } from '@/core/either'
import { ValueObject } from '@/core/entities/value-object'
import { InvalidQuantityError } from '@/domain/delivery/application/use-cases/invalid-quantity-error'

interface QuantityProps {
  value: number
}

export class Quantity extends ValueObject<QuantityProps> {
  private constructor(props: QuantityProps) {
    super(props)
  }

  get value(): number {
    return this.props.value
  }

  static create(raw: number): Either<InvalidQuantityError, Quantity> {
    if (!Number.isInteger(raw) || raw < 1) {
      return left(new InvalidQuantityError(raw))
    }

    return right(new Quantity({ value: raw }))
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/domain/delivery/enterprise/entities/rating-score.spec.ts src/domain/delivery/enterprise/entities/quantity.spec.ts`
Expected: PASS — 12 tests

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test
git add src/domain/delivery
git commit -m "feat(delivery): add rating score and quantity value objects"
```

---

### Task 3: VO `CustomerInfo` e entidade `Product`

**Files:**

- Create: `src/domain/delivery/enterprise/entities/customer-info.ts`
- Create: `src/domain/delivery/enterprise/entities/product.ts`
- Test: `src/domain/delivery/enterprise/entities/customer-info.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'

import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'

const base = {
  name: 'Maria',
  phone: '11999999999',
  address: 'Rua A, 100',
}

describe('CustomerInfo', () => {
  it('expõe os dados do cliente', () => {
    const customer = CustomerInfo.create(base)

    expect(customer.name).toBe('Maria')
    expect(customer.phone).toBe('11999999999')
    expect(customer.address).toBe('Rua A, 100')
  })

  it('é igual a outra instância com os mesmos dados', () => {
    expect(CustomerInfo.create(base).equals(CustomerInfo.create(base))).toBe(
      true,
    )
  })

  it('difere quando qualquer campo muda', () => {
    const other = CustomerInfo.create({ ...base, address: 'Rua B, 200' })

    expect(CustomerInfo.create(base).equals(other)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/delivery/enterprise/entities/customer-info.spec.ts`
Expected: FAIL — import não resolvido

- [ ] **Step 3: Write minimal implementation**

`customer-info.ts`:

```ts
import { ValueObject } from '@/core/entities/value-object'

export interface CustomerInfoProps {
  name: string
  phone: string
  address: string
}

export class CustomerInfo extends ValueObject<CustomerInfoProps> {
  private constructor(props: CustomerInfoProps) {
    super(props)
  }

  get name(): string {
    return this.props.name
  }

  get phone(): string {
    return this.props.phone
  }

  get address(): string {
    return this.props.address
  }

  static create(props: CustomerInfoProps): CustomerInfo {
    return new CustomerInfo(props)
  }
}
```

`product.ts`:

```ts
import { Entity } from '@/core/entities/entity'
import { UniqueEntityID } from '@/core/entities/unique-entity-id'

export interface ProductProps {
  name: string
  priceCents: number
}

export class Product extends Entity<ProductProps> {
  get name(): string {
    return this.props.name
  }

  get priceCents(): number {
    return this.props.priceCents
  }

  static create(props: ProductProps, id?: UniqueEntityID): Product {
    return new Product(props, id)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/delivery/enterprise/entities/customer-info.spec.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test
git add src/domain/delivery
git commit -m "feat(delivery): add customer info value object and product entity"
```

---

### Task 4: Entidade `DeliveryItem`

**Files:**

- Create: `src/domain/delivery/enterprise/entities/delivery-item.ts`
- Test: `src/domain/delivery/enterprise/entities/delivery-item.spec.ts`

O item guarda snapshot de nome e preço do produto no momento da atribuição: se o produto mudar depois, a entrega continua legível.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DeliveryItem } from '@/domain/delivery/enterprise/entities/delivery-item'
import { Product } from '@/domain/delivery/enterprise/entities/product'
import { Quantity } from '@/domain/delivery/enterprise/entities/quantity'

describe('DeliveryItem', () => {
  it('congela nome e preço do produto no momento da criação', () => {
    const productId = new UniqueEntityID()
    const product = Product.create(
      { name: 'Café', priceCents: 1990 },
      productId,
    )
    const quantity = Quantity.create(2)

    if (quantity.isLeft()) throw new Error('quantity inválida no setup')

    const item = DeliveryItem.fromProduct(product, quantity.value)

    expect(item.productId.equals(productId)).toBe(true)
    expect(item.productName).toBe('Café')
    expect(item.unitPriceCents).toBe(1990)
    expect(item.quantity.value).toBe(2)
  })

  it('calcula o subtotal', () => {
    const product = Product.create({ name: 'Café', priceCents: 1990 })
    const quantity = Quantity.create(3)

    if (quantity.isLeft()) throw new Error('quantity inválida no setup')

    expect(
      DeliveryItem.fromProduct(product, quantity.value).subtotalCents,
    ).toBe(5970)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/delivery/enterprise/entities/delivery-item.spec.ts`
Expected: FAIL — import não resolvido

- [ ] **Step 3: Write minimal implementation**

```ts
import { Entity } from '@/core/entities/entity'
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { Product } from '@/domain/delivery/enterprise/entities/product'
import { Quantity } from '@/domain/delivery/enterprise/entities/quantity'

export interface DeliveryItemProps {
  productId: UniqueEntityID
  productName: string
  unitPriceCents: number
  quantity: Quantity
}

export class DeliveryItem extends Entity<DeliveryItemProps> {
  get productId(): UniqueEntityID {
    return this.props.productId
  }

  get productName(): string {
    return this.props.productName
  }

  get unitPriceCents(): number {
    return this.props.unitPriceCents
  }

  get quantity(): Quantity {
    return this.props.quantity
  }

  get subtotalCents(): number {
    return this.props.unitPriceCents * this.props.quantity.value
  }

  static create(props: DeliveryItemProps, id?: UniqueEntityID): DeliveryItem {
    return new DeliveryItem(props, id)
  }

  static fromProduct(product: Product, quantity: Quantity): DeliveryItem {
    return new DeliveryItem({
      productId: product.id,
      productName: product.name,
      unitPriceCents: product.priceCents,
      quantity,
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/delivery/enterprise/entities/delivery-item.spec.ts`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test
git add src/domain/delivery
git commit -m "feat(delivery): add delivery item entity"
```

---

### Task 5: Eventos de domínio

**Files:**

- Create: `src/domain/delivery/enterprise/events/delivery-created.event.ts`
- Create: `src/domain/delivery/enterprise/events/delivery-assigned.event.ts`
- Create: `src/domain/delivery/enterprise/events/delivery-status-changed.event.ts`
- Create: `src/domain/delivery/enterprise/events/delivery-details-changed.event.ts`
- Create: `src/domain/delivery/enterprise/events/delivery-rated.event.ts`
- Create: `src/domain/delivery/enterprise/events/delivery-cancelled.event.ts`
- Test: `src/domain/delivery/enterprise/events/delivery-assigned.event.spec.ts`

Todo evento carrega o `courierId` dono da mudança, porque é isso que o subscriber precisa para escrever no log sem consultar o agregado de novo. `DeliveryAssignedEvent` carrega também o courier anterior: é o que permite gerar `REMOVE` para quem perdeu a entrega.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DeliveryAssignedEvent } from '@/domain/delivery/enterprise/events/delivery-assigned.event'

describe('DeliveryAssignedEvent', () => {
  it('aponta para a entrega e carrega os dois couriers', () => {
    const deliveryId = new UniqueEntityID()
    const previous = new UniqueEntityID()
    const next = new UniqueEntityID()

    const event = new DeliveryAssignedEvent(deliveryId, next, previous)

    expect(event.getAggregateId().equals(deliveryId)).toBe(true)
    expect(event.courierId.equals(next)).toBe(true)
    expect(event.previousCourierId?.equals(previous)).toBe(true)
    expect(event.occurredAt).toBeInstanceOf(Date)
  })

  it('aceita ausência de courier anterior na primeira atribuição', () => {
    const event = new DeliveryAssignedEvent(
      new UniqueEntityID(),
      new UniqueEntityID(),
      null,
    )

    expect(event.previousCourierId).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/delivery/enterprise/events/delivery-assigned.event.spec.ts`
Expected: FAIL — import não resolvido

- [ ] **Step 3: Write minimal implementation**

`delivery-assigned.event.ts`:

```ts
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvent } from '@/core/events/domain-event'

export class DeliveryAssignedEvent implements DomainEvent {
  public readonly occurredAt: Date

  constructor(
    public readonly deliveryId: UniqueEntityID,
    public readonly courierId: UniqueEntityID,
    public readonly previousCourierId: UniqueEntityID | null,
  ) {
    this.occurredAt = new Date()
  }

  getAggregateId(): UniqueEntityID {
    return this.deliveryId
  }
}
```

`delivery-created.event.ts`:

```ts
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvent } from '@/core/events/domain-event'

export class DeliveryCreatedEvent implements DomainEvent {
  public readonly occurredAt: Date

  constructor(
    public readonly deliveryId: UniqueEntityID,
    public readonly courierId: UniqueEntityID,
  ) {
    this.occurredAt = new Date()
  }

  getAggregateId(): UniqueEntityID {
    return this.deliveryId
  }
}
```

`delivery-status-changed.event.ts`:

```ts
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvent } from '@/core/events/domain-event'
import { DeliveryStatusValue } from '@/domain/delivery/enterprise/entities/delivery-status'

export class DeliveryStatusChangedEvent implements DomainEvent {
  public readonly occurredAt: Date

  constructor(
    public readonly deliveryId: UniqueEntityID,
    public readonly courierId: UniqueEntityID,
    public readonly status: DeliveryStatusValue,
  ) {
    this.occurredAt = new Date()
  }

  getAggregateId(): UniqueEntityID {
    return this.deliveryId
  }
}
```

`delivery-details-changed.event.ts`:

```ts
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvent } from '@/core/events/domain-event'

export class DeliveryDetailsChangedEvent implements DomainEvent {
  public readonly occurredAt: Date

  constructor(
    public readonly deliveryId: UniqueEntityID,
    public readonly courierId: UniqueEntityID,
  ) {
    this.occurredAt = new Date()
  }

  getAggregateId(): UniqueEntityID {
    return this.deliveryId
  }
}
```

`delivery-rated.event.ts`:

```ts
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvent } from '@/core/events/domain-event'

export class DeliveryRatedEvent implements DomainEvent {
  public readonly occurredAt: Date

  constructor(
    public readonly deliveryId: UniqueEntityID,
    public readonly courierId: UniqueEntityID,
    public readonly score: number,
  ) {
    this.occurredAt = new Date()
  }

  getAggregateId(): UniqueEntityID {
    return this.deliveryId
  }
}
```

`delivery-cancelled.event.ts`:

```ts
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvent } from '@/core/events/domain-event'

export class DeliveryCancelledEvent implements DomainEvent {
  public readonly occurredAt: Date

  constructor(
    public readonly deliveryId: UniqueEntityID,
    public readonly courierId: UniqueEntityID,
    public readonly reason: string,
  ) {
    this.occurredAt = new Date()
  }

  getAggregateId(): UniqueEntityID {
    return this.deliveryId
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/delivery/enterprise/events/delivery-assigned.event.spec.ts`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test
git add src/domain/delivery
git commit -m "feat(delivery): add delivery domain events"
```

---

### Task 6: Erros de domínio da entrega

**Files:**

- Create: `src/domain/delivery/application/use-cases/delivery-not-found-error.ts`
- Create: `src/domain/delivery/application/use-cases/courier-mismatch-error.ts`
- Create: `src/domain/delivery/application/use-cases/invalid-status-transition-error.ts`
- Create: `src/domain/delivery/application/use-cases/delivery-already-finalized-error.ts`
- Create: `src/domain/delivery/application/use-cases/delivery-not-delivered-error.ts`
- Create: `src/domain/delivery/application/use-cases/rating-already-exists-error.ts`
- Test: `src/domain/delivery/application/use-cases/delivery-errors.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'

import { UseCaseError } from '@/core/errors/use-case-error'
import { CourierMismatchError } from '@/domain/delivery/application/use-cases/courier-mismatch-error'
import { DeliveryAlreadyFinalizedError } from '@/domain/delivery/application/use-cases/delivery-already-finalized-error'
import { DeliveryNotDeliveredError } from '@/domain/delivery/application/use-cases/delivery-not-delivered-error'
import { DeliveryNotFoundError } from '@/domain/delivery/application/use-cases/delivery-not-found-error'
import { InvalidStatusTransitionError } from '@/domain/delivery/application/use-cases/invalid-status-transition-error'
import { RatingAlreadyExistsError } from '@/domain/delivery/application/use-cases/rating-already-exists-error'

describe('erros de domínio da entrega', () => {
  it('todos implementam UseCaseError com mensagem', () => {
    const errors: UseCaseError[] = [
      new DeliveryNotFoundError(),
      new CourierMismatchError(),
      new InvalidStatusTransitionError('DELIVERED', 'PENDING'),
      new DeliveryAlreadyFinalizedError(),
      new DeliveryNotDeliveredError(),
      new RatingAlreadyExistsError(),
    ]

    for (const error of errors) {
      expect(error.message.length).toBeGreaterThan(0)
    }
  })

  it('a transição inválida diz de onde para onde', () => {
    expect(
      new InvalidStatusTransitionError('DELIVERED', 'PENDING').message,
    ).toContain('DELIVERED')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/delivery/application/use-cases/delivery-errors.spec.ts`
Expected: FAIL — imports não resolvidos

- [ ] **Step 3: Write minimal implementation**

```ts
// delivery-not-found-error.ts
import { UseCaseError } from '@/core/errors/use-case-error'

export class DeliveryNotFoundError extends Error implements UseCaseError {
  constructor() {
    super('Delivery not found')
  }
}
```

```ts
// courier-mismatch-error.ts
import { UseCaseError } from '@/core/errors/use-case-error'

export class CourierMismatchError extends Error implements UseCaseError {
  constructor() {
    super('Delivery belongs to another courier')
  }
}
```

```ts
// invalid-status-transition-error.ts
import { UseCaseError } from '@/core/errors/use-case-error'
import { DeliveryStatusValue } from '@/domain/delivery/enterprise/entities/delivery-status'

export class InvalidStatusTransitionError
  extends Error
  implements UseCaseError
{
  constructor(
    readonly from: DeliveryStatusValue,
    readonly to: DeliveryStatusValue,
  ) {
    super(`Invalid status transition: ${from} -> ${to}`)
  }
}
```

```ts
// delivery-already-finalized-error.ts
import { UseCaseError } from '@/core/errors/use-case-error'

export class DeliveryAlreadyFinalizedError
  extends Error
  implements UseCaseError
{
  constructor() {
    super('Delivery is already finalized and cannot be changed')
  }
}
```

```ts
// delivery-not-delivered-error.ts
import { UseCaseError } from '@/core/errors/use-case-error'

export class DeliveryNotDeliveredError extends Error implements UseCaseError {
  constructor() {
    super('Only delivered deliveries can be rated')
  }
}
```

```ts
// rating-already-exists-error.ts
import { UseCaseError } from '@/core/errors/use-case-error'

export class RatingAlreadyExistsError extends Error implements UseCaseError {
  constructor() {
    super('Delivery has already been rated')
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/delivery/application/use-cases/delivery-errors.spec.ts`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test
git add src/domain/delivery
git commit -m "feat(delivery): add delivery domain errors"
```

---

### Task 7: Agregado `Delivery` — criação, atribuição e transições

**Files:**

- Create: `src/domain/delivery/enterprise/entities/delivery.ts`
- Test: `src/domain/delivery/enterprise/entities/delivery.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvents } from '@/core/events/domain-events'
import { DeliveryAlreadyFinalizedError } from '@/domain/delivery/application/use-cases/delivery-already-finalized-error'
import { InvalidStatusTransitionError } from '@/domain/delivery/application/use-cases/invalid-status-transition-error'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { DeliveryItem } from '@/domain/delivery/enterprise/entities/delivery-item'
import { Product } from '@/domain/delivery/enterprise/entities/product'
import { Quantity } from '@/domain/delivery/enterprise/entities/quantity'
import { DeliveryAssignedEvent } from '@/domain/delivery/enterprise/events/delivery-assigned.event'
import { DeliveryStatusChangedEvent } from '@/domain/delivery/enterprise/events/delivery-status-changed.event'

function makeItem(): DeliveryItem {
  const quantity = Quantity.create(1)

  if (quantity.isLeft()) throw new Error('quantity inválida no setup')

  return DeliveryItem.fromProduct(
    Product.create({ name: 'Café', priceCents: 1990 }),
    quantity.value,
  )
}

function makeDelivery(courierId = new UniqueEntityID()): Delivery {
  const delivery = Delivery.create({
    courierId,
    customer: CustomerInfo.create({
      name: 'Maria',
      phone: '11999999999',
      address: 'Rua A, 100',
    }),
    items: [makeItem()],
  })

  // Descarta o DeliveryCreatedEvent para que as contagens abaixo enxerguem
  // só os eventos da ação sob teste.
  delivery.clearEvents()

  return delivery
}

describe('Delivery — criação e transições', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()
  })

  it('nasce em PENDING, sem tentativas e sem avaliação', () => {
    const delivery = makeDelivery()

    expect(delivery.status.value).toBe('PENDING')
    expect(delivery.attempts).toBe(0)
    expect(delivery.rating).toBeNull()
    expect(delivery.revision).toBe(0)
  })

  it('calcula o total a partir dos itens', () => {
    expect(makeDelivery().totalCents).toBe(1990)
  })

  it('sai para entrega e emite evento de status', () => {
    const delivery = makeDelivery()

    const result = delivery.markOutForDelivery()

    expect(result.isRight()).toBe(true)
    expect(delivery.status.value).toBe('OUT_FOR_DELIVERY')
    expect(delivery.domainEvents).toHaveLength(1)
    expect(delivery.domainEvents[0]).toBeInstanceOf(DeliveryStatusChangedEvent)
  })

  it('recusa entregar sem ter saído para entrega', () => {
    const delivery = makeDelivery()

    const result = delivery.markDelivered('Maria', new Date())

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(InvalidStatusTransitionError)
    expect(delivery.status.value).toBe('PENDING')
  })

  it('entrega registrando quem recebeu', () => {
    const delivery = makeDelivery()
    const occurredAt = new Date('2026-09-21T12:00:00.000Z')
    delivery.markOutForDelivery()

    const result = delivery.markDelivered('Porteiro', occurredAt)

    expect(result.isRight()).toBe(true)
    expect(delivery.status.value).toBe('DELIVERED')
    expect(delivery.receivedBy).toBe('Porteiro')
    expect(delivery.deliveredAt).toEqual(occurredAt)
  })

  it('tentativa falha incrementa attempts e volta para PENDING', () => {
    const delivery = makeDelivery()
    delivery.markOutForDelivery()

    const result = delivery.registerFailedAttempt(
      'Ausente',
      new Date('2026-09-21T12:00:00.000Z'),
    )

    expect(result.isRight()).toBe(true)
    expect(delivery.status.value).toBe('PENDING')
    expect(delivery.attempts).toBe(1)
    expect(delivery.lastFailureReason).toBe('Ausente')
  })

  it('cancela e emite status changed seguido de cancelled', () => {
    const delivery = makeDelivery()

    const result = delivery.cancel('Cliente desistiu')

    expect(result.isRight()).toBe(true)
    expect(delivery.status.value).toBe('CANCELLED')
    expect(delivery.domainEvents).toHaveLength(2)
  })

  it('recusa cancelar entrega já entregue', () => {
    const delivery = makeDelivery()
    delivery.markOutForDelivery()
    delivery.markDelivered('Maria', new Date())

    const result = delivery.cancel('tarde demais')

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(InvalidStatusTransitionError)
  })

  it('reatribui carregando o courier anterior no evento', () => {
    const previous = new UniqueEntityID()
    const next = new UniqueEntityID()
    const delivery = makeDelivery(previous)

    const result = delivery.assignTo(next)

    expect(result.isRight()).toBe(true)
    expect(delivery.courierId.equals(next)).toBe(true)

    const event = delivery.domainEvents[0] as DeliveryAssignedEvent
    expect(event).toBeInstanceOf(DeliveryAssignedEvent)
    expect(event.previousCourierId?.equals(previous)).toBe(true)
  })

  it('reatribuir para o mesmo courier não emite evento', () => {
    const courierId = new UniqueEntityID()
    const delivery = makeDelivery(courierId)

    delivery.assignTo(courierId)

    expect(delivery.domainEvents).toHaveLength(0)
  })

  it('recusa reatribuir entrega finalizada', () => {
    const delivery = makeDelivery()
    delivery.cancel('desistiu')

    const result = delivery.assignTo(new UniqueEntityID())

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(DeliveryAlreadyFinalizedError)
  })

  it('incrementa revision a cada mudança', () => {
    const delivery = makeDelivery()

    delivery.markOutForDelivery()
    delivery.markDelivered('Maria', new Date())

    expect(delivery.revision).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/delivery/enterprise/entities/delivery.spec.ts`
Expected: FAIL — `Failed to resolve import "@/domain/delivery/enterprise/entities/delivery"`

- [ ] **Step 3: Write minimal implementation**

```ts
import { Either, left, right } from '@/core/either'
import { AggregateRoot } from '@/core/entities/aggregate-root'
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { Optional } from '@/core/types/optional'
import { DeliveryAlreadyFinalizedError } from '@/domain/delivery/application/use-cases/delivery-already-finalized-error'
import { InvalidStatusTransitionError } from '@/domain/delivery/application/use-cases/invalid-status-transition-error'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { DeliveryItem } from '@/domain/delivery/enterprise/entities/delivery-item'
import { DeliveryStatus } from '@/domain/delivery/enterprise/entities/delivery-status'
import { RatingScore } from '@/domain/delivery/enterprise/entities/rating-score'
import { DeliveryAssignedEvent } from '@/domain/delivery/enterprise/events/delivery-assigned.event'
import { DeliveryCancelledEvent } from '@/domain/delivery/enterprise/events/delivery-cancelled.event'
import { DeliveryCreatedEvent } from '@/domain/delivery/enterprise/events/delivery-created.event'
import { DeliveryStatusChangedEvent } from '@/domain/delivery/enterprise/events/delivery-status-changed.event'

export interface DeliveryRating {
  score: RatingScore
  comment: string | null
  ratedAt: Date
}

export interface DeliveryProps {
  courierId: UniqueEntityID
  customer: CustomerInfo
  items: DeliveryItem[]
  status: DeliveryStatus
  attempts: number
  rating: DeliveryRating | null
  receivedBy: string | null
  deliveredAt: Date | null
  cancelReason: string | null
  lastFailureReason: string | null
  revision: number
  createdAt: Date
  updatedAt: Date
}

type CreateDeliveryProps = Optional<
  DeliveryProps,
  | 'status'
  | 'attempts'
  | 'rating'
  | 'receivedBy'
  | 'deliveredAt'
  | 'cancelReason'
  | 'lastFailureReason'
  | 'revision'
  | 'createdAt'
  | 'updatedAt'
>

export class Delivery extends AggregateRoot<DeliveryProps> {
  get courierId(): UniqueEntityID {
    return this.props.courierId
  }

  get customer(): CustomerInfo {
    return this.props.customer
  }

  get items(): readonly DeliveryItem[] {
    return this.props.items
  }

  get status(): DeliveryStatus {
    return this.props.status
  }

  get attempts(): number {
    return this.props.attempts
  }

  get rating(): DeliveryRating | null {
    return this.props.rating
  }

  get receivedBy(): string | null {
    return this.props.receivedBy
  }

  get deliveredAt(): Date | null {
    return this.props.deliveredAt
  }

  get cancelReason(): string | null {
    return this.props.cancelReason
  }

  get lastFailureReason(): string | null {
    return this.props.lastFailureReason
  }

  get revision(): number {
    return this.props.revision
  }

  get createdAt(): Date {
    return this.props.createdAt
  }

  get updatedAt(): Date {
    return this.props.updatedAt
  }

  get totalCents(): number {
    return this.props.items.reduce(
      (total, item) => total + item.subtotalCents,
      0,
    )
  }

  assignTo(
    courierId: UniqueEntityID,
  ): Either<DeliveryAlreadyFinalizedError, null> {
    if (this.props.status.isFinal) {
      return left(new DeliveryAlreadyFinalizedError())
    }

    if (this.props.courierId.equals(courierId)) {
      return right(null)
    }

    const previousCourierId = this.props.courierId

    this.props.courierId = courierId
    this.touch()
    this.addDomainEvent(
      new DeliveryAssignedEvent(this.id, courierId, previousCourierId),
    )

    return right(null)
  }

  markOutForDelivery(
    occurredAt: Date = new Date(),
  ): Either<InvalidStatusTransitionError, null> {
    return this.transitionTo(DeliveryStatus.outForDelivery(), occurredAt)
  }

  markDelivered(
    receivedBy: string,
    occurredAt: Date,
  ): Either<InvalidStatusTransitionError, null> {
    const result = this.transitionTo(DeliveryStatus.delivered(), occurredAt)

    if (result.isLeft()) {
      return result
    }

    this.props.receivedBy = receivedBy
    this.props.deliveredAt = occurredAt

    return right(null)
  }

  registerFailedAttempt(
    reason: string,
    occurredAt: Date,
  ): Either<InvalidStatusTransitionError, null> {
    const result = this.transitionTo(DeliveryStatus.pending(), occurredAt)

    if (result.isLeft()) {
      return result
    }

    this.props.attempts += 1
    this.props.lastFailureReason = reason

    return right(null)
  }

  cancel(reason: string): Either<InvalidStatusTransitionError, null> {
    const result = this.transitionTo(DeliveryStatus.cancelled(), new Date())

    if (result.isLeft()) {
      return result
    }

    this.props.cancelReason = reason
    this.addDomainEvent(
      new DeliveryCancelledEvent(this.id, this.props.courierId, reason),
    )

    return right(null)
  }

  private transitionTo(
    next: DeliveryStatus,
    occurredAt: Date,
  ): Either<InvalidStatusTransitionError, null> {
    if (!this.props.status.canTransitionTo(next)) {
      return left(
        new InvalidStatusTransitionError(this.props.status.value, next.value),
      )
    }

    this.props.status = next
    this.touch(occurredAt)
    this.addDomainEvent(
      new DeliveryStatusChangedEvent(this.id, this.props.courierId, next.value),
    )

    return right(null)
  }

  private touch(at: Date = new Date()): void {
    this.props.updatedAt = at
    this.props.revision += 1
  }

  static create(props: CreateDeliveryProps, id?: UniqueEntityID): Delivery {
    const now = new Date()

    const delivery = new Delivery(
      {
        ...props,
        status: props.status ?? DeliveryStatus.pending(),
        attempts: props.attempts ?? 0,
        rating: props.rating ?? null,
        receivedBy: props.receivedBy ?? null,
        deliveredAt: props.deliveredAt ?? null,
        cancelReason: props.cancelReason ?? null,
        lastFailureReason: props.lastFailureReason ?? null,
        revision: props.revision ?? 0,
        createdAt: props.createdAt ?? now,
        updatedAt: props.updatedAt ?? now,
      },
      id,
    )

    if (!id) {
      delivery.addDomainEvent(
        new DeliveryCreatedEvent(delivery.id, delivery.courierId),
      )
    }

    return delivery
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/delivery/enterprise/entities/delivery.spec.ts`
Expected: PASS — 12 tests

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test
git add src/domain/delivery
git commit -m "feat(delivery): add delivery aggregate with state machine"
```

---

### Task 8: Agregado `Delivery` — alteração de itens, cliente e avaliação

**Files:**

- Modify: `src/domain/delivery/enterprise/entities/delivery.ts`
- Modify: `src/domain/delivery/enterprise/entities/delivery.spec.ts`

- [ ] **Step 1: Write the failing test**

Adicionar ao final de `delivery.spec.ts`, dentro do arquivo, como um novo `describe`:

```ts
describe('Delivery — detalhes e avaliação', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()
  })

  it('troca os itens enquanto a entrega não terminou', () => {
    const delivery = makeDelivery()

    const result = delivery.changeItems([makeItem(), makeItem()])

    expect(result.isRight()).toBe(true)
    expect(delivery.items).toHaveLength(2)
    expect(delivery.totalCents).toBe(3980)
  })

  it('troca os dados do cliente', () => {
    const delivery = makeDelivery()

    const result = delivery.changeCustomer(
      CustomerInfo.create({
        name: 'Maria',
        phone: '11999999999',
        address: 'Rua Nova, 500',
      }),
    )

    expect(result.isRight()).toBe(true)
    expect(delivery.customer.address).toBe('Rua Nova, 500')
  })

  it('recusa alterar itens de entrega finalizada', () => {
    const delivery = makeDelivery()
    delivery.markOutForDelivery()
    delivery.markDelivered('Maria', new Date())

    const result = delivery.changeItems([makeItem()])

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(DeliveryAlreadyFinalizedError)
  })

  it('avalia entrega entregue', () => {
    const delivery = makeDelivery()
    delivery.markOutForDelivery()
    delivery.markDelivered('Maria', new Date())

    const score = RatingScore.create(5)
    if (score.isLeft()) throw new Error('score inválido no setup')

    const result = delivery.rate(score.value, 'Rápido')

    expect(result.isRight()).toBe(true)
    expect(delivery.rating?.score.value).toBe(5)
    expect(delivery.rating?.comment).toBe('Rápido')
  })

  it('recusa avaliar entrega não entregue', () => {
    const delivery = makeDelivery()
    const score = RatingScore.create(5)
    if (score.isLeft()) throw new Error('score inválido no setup')

    const result = delivery.rate(score.value, null)

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(DeliveryNotDeliveredError)
  })

  it('recusa avaliar duas vezes', () => {
    const delivery = makeDelivery()
    delivery.markOutForDelivery()
    delivery.markDelivered('Maria', new Date())

    const score = RatingScore.create(4)
    if (score.isLeft()) throw new Error('score inválido no setup')

    delivery.rate(score.value, null)
    const result = delivery.rate(score.value, null)

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(RatingAlreadyExistsError)
  })
})
```

Adicionar aos imports do arquivo de teste:

```ts
import { DeliveryNotDeliveredError } from '@/domain/delivery/application/use-cases/delivery-not-delivered-error'
import { RatingAlreadyExistsError } from '@/domain/delivery/application/use-cases/rating-already-exists-error'
import { RatingScore } from '@/domain/delivery/enterprise/entities/rating-score'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/delivery/enterprise/entities/delivery.spec.ts`
Expected: FAIL — `delivery.changeItems is not a function`

- [ ] **Step 3: Write minimal implementation**

Adicionar aos imports de `delivery.ts`:

```ts
import { DeliveryNotDeliveredError } from '@/domain/delivery/application/use-cases/delivery-not-delivered-error'
import { RatingAlreadyExistsError } from '@/domain/delivery/application/use-cases/rating-already-exists-error'
import { DeliveryDetailsChangedEvent } from '@/domain/delivery/enterprise/events/delivery-details-changed.event'
import { DeliveryRatedEvent } from '@/domain/delivery/enterprise/events/delivery-rated.event'
```

Adicionar os três métodos públicos à classe, antes de `transitionTo`:

```ts
  changeItems(items: DeliveryItem[]): Either<DeliveryAlreadyFinalizedError, null> {
    if (this.props.status.isFinal) {
      return left(new DeliveryAlreadyFinalizedError())
    }

    this.props.items = items
    this.touch()
    this.addDomainEvent(
      new DeliveryDetailsChangedEvent(this.id, this.props.courierId),
    )

    return right(null)
  }

  changeCustomer(
    customer: CustomerInfo,
  ): Either<DeliveryAlreadyFinalizedError, null> {
    if (this.props.status.isFinal) {
      return left(new DeliveryAlreadyFinalizedError())
    }

    if (this.props.customer.equals(customer)) {
      return right(null)
    }

    this.props.customer = customer
    this.touch()
    this.addDomainEvent(
      new DeliveryDetailsChangedEvent(this.id, this.props.courierId),
    )

    return right(null)
  }

  rate(
    score: RatingScore,
    comment: string | null,
  ): Either<DeliveryNotDeliveredError | RatingAlreadyExistsError, null> {
    if (this.props.status.value !== 'DELIVERED') {
      return left(new DeliveryNotDeliveredError())
    }

    if (this.props.rating) {
      return left(new RatingAlreadyExistsError())
    }

    this.props.rating = { score, comment, ratedAt: new Date() }
    this.touch()
    this.addDomainEvent(
      new DeliveryRatedEvent(this.id, this.props.courierId, score.value),
    )

    return right(null)
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/delivery/enterprise/entities/delivery.spec.ts`
Expected: PASS — 18 tests

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test
git add src/domain/delivery
git commit -m "feat(delivery): add item, customer and rating changes to aggregate"
```

---

### Task 9: `DeliveryChange` e contratos de repositório

**Files:**

- Create: `src/domain/delivery/enterprise/entities/delivery-change.ts`
- Create: `src/domain/delivery/application/repositories/deliveries-repository.ts`
- Create: `src/domain/delivery/application/repositories/delivery-changes-repository.ts`
- Create: `src/domain/delivery/application/repositories/sync-state-repository.ts`
- Create: `src/domain/delivery/application/repositories/products-repository.ts`
- Create: `src/domain/delivery/application/repositories/processed-delivery-events-repository.ts`
- Test: `src/domain/delivery/enterprise/entities/delivery-change.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DeliveryChange } from '@/domain/delivery/enterprise/entities/delivery-change'

describe('DeliveryChange', () => {
  it('guarda versão, tipo, entrega e courier', () => {
    const deliveryId = new UniqueEntityID()
    const courierId = new UniqueEntityID()

    const change = DeliveryChange.create({
      version: 7,
      type: 'UPSERT',
      deliveryId,
      courierId,
    })

    expect(change.version).toBe(7)
    expect(change.type).toBe('UPSERT')
    expect(change.deliveryId.equals(deliveryId)).toBe(true)
    expect(change.courierId.equals(courierId)).toBe(true)
    expect(change.occurredAt).toBeInstanceOf(Date)
  })

  it('aceita REMOVE como tombstone de escopo', () => {
    const change = DeliveryChange.create({
      version: 8,
      type: 'REMOVE',
      deliveryId: new UniqueEntityID(),
      courierId: new UniqueEntityID(),
    })

    expect(change.type).toBe('REMOVE')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/delivery/enterprise/entities/delivery-change.spec.ts`
Expected: FAIL — import não resolvido

- [ ] **Step 3: Write minimal implementation**

`delivery-change.ts`:

```ts
import { Entity } from '@/core/entities/entity'
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { Optional } from '@/core/types/optional'

export type DeliveryChangeType = 'UPSERT' | 'REMOVE'

export interface DeliveryChangeProps {
  version: number
  type: DeliveryChangeType
  deliveryId: UniqueEntityID
  courierId: UniqueEntityID
  occurredAt: Date
}

export class DeliveryChange extends Entity<DeliveryChangeProps> {
  get version(): number {
    return this.props.version
  }

  get type(): DeliveryChangeType {
    return this.props.type
  }

  get deliveryId(): UniqueEntityID {
    return this.props.deliveryId
  }

  get courierId(): UniqueEntityID {
    return this.props.courierId
  }

  get occurredAt(): Date {
    return this.props.occurredAt
  }

  static create(
    props: Optional<DeliveryChangeProps, 'occurredAt'>,
    id?: UniqueEntityID,
  ): DeliveryChange {
    return new DeliveryChange(
      { ...props, occurredAt: props.occurredAt ?? new Date() },
      id,
    )
  }
}
```

`deliveries-repository.ts`:

```ts
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'

export interface FindManyByCourierParams {
  courierId: string
  limit: number
  cursor?: string
}

export abstract class DeliveriesRepository {
  abstract findById(id: string): Promise<Delivery | null>
  abstract findManyByCourier(
    params: FindManyByCourierParams,
  ): Promise<Delivery[]>
  abstract countByCourier(courierId: string): Promise<number>
  abstract create(delivery: Delivery): Promise<void>
  abstract save(delivery: Delivery): Promise<void>
}
```

`delivery-changes-repository.ts`:

```ts
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import {
  DeliveryChange,
  DeliveryChangeType,
} from '@/domain/delivery/enterprise/entities/delivery-change'

export interface AppendDeliveryChangeInput {
  type: DeliveryChangeType
  deliveryId: UniqueEntityID
  courierId: UniqueEntityID
}

export interface FindChangesForCourierParams {
  courierId: string
  sinceVersion: number
  limit: number
}

export abstract class DeliveryChangesRepository {
  abstract append(input: AppendDeliveryChangeInput): Promise<DeliveryChange>
  abstract findManyForCourierSince(
    params: FindChangesForCourierParams,
  ): Promise<DeliveryChange[]>
  abstract hasChangesForCourierAfter(
    courierId: string,
    version: number,
  ): Promise<boolean>
  abstract minVersion(): Promise<number>
}
```

`sync-state-repository.ts`:

```ts
export abstract class SyncStateRepository {
  abstract currentVersion(): Promise<number>
}
```

`products-repository.ts`:

```ts
import { Product } from '@/domain/delivery/enterprise/entities/product'

export abstract class ProductsRepository {
  abstract findById(id: string): Promise<Product | null>
  abstract findManyByIds(ids: string[]): Promise<Product[]>
}
```

`processed-delivery-events-repository.ts`:

```ts
export abstract class ProcessedDeliveryEventsRepository {
  abstract has(clientEventId: string): Promise<boolean>
  abstract register(clientEventId: string): Promise<void>
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/delivery/enterprise/entities/delivery-change.spec.ts`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test
git add src/domain/delivery
git commit -m "feat(delivery): add change entity and repository contracts"
```

---

### Task 10: Repositórios in-memory

**Files:**

- Create: `src/infrastructure/database/in-memory/in-memory-sync-state-repository.ts`
- Create: `src/infrastructure/database/in-memory/in-memory-delivery-changes-repository.ts`
- Create: `src/infrastructure/database/in-memory/in-memory-deliveries-repository.ts`
- Create: `src/infrastructure/database/in-memory/in-memory-products-repository.ts`
- Create: `src/infrastructure/database/in-memory/in-memory-processed-delivery-events-repository.ts`
- Test: `src/infrastructure/database/in-memory/in-memory-delivery-changes-repository.spec.ts`

Dois pontos que não são detalhe de implementação:

1. `InMemorySyncStateRepository.increment()` é **síncrono** e é o único lugar que atribui versão. O repositório de changes chama esse método concreto (não o contrato) para que não exista janela de `await` entre pegar a versão e gravar a entrada — é a tradução, em memória, da seção crítica descrita no spec.
2. `create`/`save` de entregas despacham os Domain Events **depois** de gravar. Nunca antes.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { InMemoryDeliveryChangesRepository } from '@/infrastructure/database/in-memory/in-memory-delivery-changes-repository'
import { InMemorySyncStateRepository } from '@/infrastructure/database/in-memory/in-memory-sync-state-repository'

let syncState: InMemorySyncStateRepository
let sut: InMemoryDeliveryChangesRepository

const courierId = new UniqueEntityID()
const otherCourierId = new UniqueEntityID()

describe('InMemoryDeliveryChangesRepository', () => {
  beforeEach(() => {
    syncState = new InMemorySyncStateRepository()
    sut = new InMemoryDeliveryChangesRepository(syncState)
  })

  it('atribui versões crescentes e avança o sync state', async () => {
    const first = await sut.append({
      type: 'UPSERT',
      deliveryId: new UniqueEntityID(),
      courierId,
    })
    const second = await sut.append({
      type: 'UPSERT',
      deliveryId: new UniqueEntityID(),
      courierId,
    })

    expect(first.version).toBe(1)
    expect(second.version).toBe(2)
    await expect(syncState.currentVersion()).resolves.toBe(2)
  })

  it('filtra por courier e por cursor, em ordem crescente', async () => {
    await sut.append({
      type: 'UPSERT',
      deliveryId: new UniqueEntityID(),
      courierId,
    })
    await sut.append({
      type: 'UPSERT',
      deliveryId: new UniqueEntityID(),
      courierId: otherCourierId,
    })
    const third = await sut.append({
      type: 'UPSERT',
      deliveryId: new UniqueEntityID(),
      courierId,
    })

    const rows = await sut.findManyForCourierSince({
      courierId: courierId.toString(),
      sinceVersion: 1,
      limit: 10,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].version).toBe(third.version)
  })

  it('respeita o limite', async () => {
    for (let index = 0; index < 5; index += 1) {
      await sut.append({
        type: 'UPSERT',
        deliveryId: new UniqueEntityID(),
        courierId,
      })
    }

    const rows = await sut.findManyForCourierSince({
      courierId: courierId.toString(),
      sinceVersion: 0,
      limit: 2,
    })

    expect(rows.map((row) => row.version)).toEqual([1, 2])
  })

  it('sabe dizer se há mudanças acima de uma versão', async () => {
    await sut.append({
      type: 'UPSERT',
      deliveryId: new UniqueEntityID(),
      courierId,
    })

    await expect(
      sut.hasChangesForCourierAfter(courierId.toString(), 0),
    ).resolves.toBe(true)
    await expect(
      sut.hasChangesForCourierAfter(courierId.toString(), 1),
    ).resolves.toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/infrastructure/database/in-memory/in-memory-delivery-changes-repository.spec.ts`
Expected: FAIL — imports não resolvidos

- [ ] **Step 3: Write minimal implementation**

`in-memory-sync-state-repository.ts`:

```ts
import { Injectable } from '@nestjs/common'

import { SyncStateRepository } from '@/domain/delivery/application/repositories/sync-state-repository'

@Injectable()
export class InMemorySyncStateRepository extends SyncStateRepository {
  private version = 0

  /**
   * Síncrono de propósito: é o único ponto que atribui versão, e não pode
   * existir `await` entre incrementar e gravar a entrada no log.
   */
  increment(): number {
    this.version += 1

    return this.version
  }

  currentVersion(): Promise<number> {
    return Promise.resolve(this.version)
  }
}
```

`in-memory-delivery-changes-repository.ts`:

```ts
import { Injectable } from '@nestjs/common'

import {
  AppendDeliveryChangeInput,
  DeliveryChangesRepository,
  FindChangesForCourierParams,
} from '@/domain/delivery/application/repositories/delivery-changes-repository'
import { DeliveryChange } from '@/domain/delivery/enterprise/entities/delivery-change'
import { InMemorySyncStateRepository } from '@/infrastructure/database/in-memory/in-memory-sync-state-repository'

@Injectable()
export class InMemoryDeliveryChangesRepository extends DeliveryChangesRepository {
  public items: DeliveryChange[] = []

  constructor(private readonly syncState: InMemorySyncStateRepository) {
    super()
  }

  append(input: AppendDeliveryChangeInput): Promise<DeliveryChange> {
    const change = DeliveryChange.create({
      version: this.syncState.increment(),
      type: input.type,
      deliveryId: input.deliveryId,
      courierId: input.courierId,
    })

    this.items.push(change)

    return Promise.resolve(change)
  }

  findManyForCourierSince({
    courierId,
    sinceVersion,
    limit,
  }: FindChangesForCourierParams): Promise<DeliveryChange[]> {
    const rows = this.items
      .filter(
        (item) =>
          item.courierId.toString() === courierId &&
          item.version > sinceVersion,
      )
      .sort((a, b) => a.version - b.version)
      .slice(0, limit)

    return Promise.resolve(rows)
  }

  hasChangesForCourierAfter(
    courierId: string,
    version: number,
  ): Promise<boolean> {
    return Promise.resolve(
      this.items.some(
        (item) =>
          item.courierId.toString() === courierId && item.version > version,
      ),
    )
  }

  minVersion(): Promise<number> {
    return Promise.resolve(0)
  }
}
```

`in-memory-deliveries-repository.ts`:

```ts
import { Injectable } from '@nestjs/common'

import { DomainEvents } from '@/core/events/domain-events'
import {
  DeliveriesRepository,
  FindManyByCourierParams,
} from '@/domain/delivery/application/repositories/deliveries-repository'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'

@Injectable()
export class InMemoryDeliveriesRepository extends DeliveriesRepository {
  public items: Delivery[] = []

  findById(id: string): Promise<Delivery | null> {
    return Promise.resolve(
      this.items.find((item) => item.id.toString() === id) ?? null,
    )
  }

  findManyByCourier({
    courierId,
    limit,
    cursor,
  }: FindManyByCourierParams): Promise<Delivery[]> {
    const ordered = this.activeForCourier(courierId)

    if (!cursor) {
      return Promise.resolve(ordered.slice(0, limit))
    }

    const cursorIndex = ordered.findIndex(
      (item) => item.id.toString() === cursor,
    )

    if (cursorIndex < 0) {
      return Promise.resolve([])
    }

    return Promise.resolve(
      ordered.slice(cursorIndex + 1, cursorIndex + 1 + limit),
    )
  }

  countByCourier(courierId: string): Promise<number> {
    return Promise.resolve(this.activeForCourier(courierId).length)
  }

  create(delivery: Delivery): Promise<void> {
    this.items.push(delivery)

    DomainEvents.dispatchEventsForAggregate(delivery.id)

    return Promise.resolve()
  }

  save(delivery: Delivery): Promise<void> {
    const index = this.items.findIndex((item) => item.equals(delivery))

    if (index >= 0) {
      this.items[index] = delivery
    }

    DomainEvents.dispatchEventsForAggregate(delivery.id)

    return Promise.resolve()
  }

  /** Entrega cancelada sai da carteira; entregue continua, porque ainda recebe avaliação. */
  private activeForCourier(courierId: string): Delivery[] {
    return this.items
      .filter(
        (item) =>
          item.courierId.toString() === courierId &&
          item.status.value !== 'CANCELLED',
      )
      .sort((a, b) => a.id.toString().localeCompare(b.id.toString()))
  }
}
```

`in-memory-products-repository.ts`:

```ts
import { Injectable } from '@nestjs/common'

import { ProductsRepository } from '@/domain/delivery/application/repositories/products-repository'
import { Product } from '@/domain/delivery/enterprise/entities/product'

@Injectable()
export class InMemoryProductsRepository extends ProductsRepository {
  public items: Product[] = []

  findById(id: string): Promise<Product | null> {
    return Promise.resolve(
      this.items.find((item) => item.id.toString() === id) ?? null,
    )
  }

  findManyByIds(ids: string[]): Promise<Product[]> {
    return Promise.resolve(
      this.items.filter((item) => ids.includes(item.id.toString())),
    )
  }
}
```

`in-memory-processed-delivery-events-repository.ts`:

```ts
import { Injectable } from '@nestjs/common'

import { ProcessedDeliveryEventsRepository } from '@/domain/delivery/application/repositories/processed-delivery-events-repository'

@Injectable()
export class InMemoryProcessedDeliveryEventsRepository extends ProcessedDeliveryEventsRepository {
  public items = new Set<string>()

  has(clientEventId: string): Promise<boolean> {
    return Promise.resolve(this.items.has(clientEventId))
  }

  register(clientEventId: string): Promise<void> {
    this.items.add(clientEventId)

    return Promise.resolve()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/infrastructure/database/in-memory/in-memory-delivery-changes-repository.spec.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test
git add src/infrastructure/database/in-memory
git commit -m "feat(delivery): add in-memory repositories"
```

---

### Task 11: Subscriber que escreve no log

**Files:**

- Create: `src/infrastructure/events/append-delivery-change.subscriber.ts`
- Test: `src/infrastructure/events/append-delivery-change.subscriber.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvents } from '@/core/events/domain-events'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'
import { InMemoryDeliveryChangesRepository } from '@/infrastructure/database/in-memory/in-memory-delivery-changes-repository'
import { InMemorySyncStateRepository } from '@/infrastructure/database/in-memory/in-memory-sync-state-repository'
import { AppendDeliveryChangeSubscriber } from '@/infrastructure/events/append-delivery-change.subscriber'

let deliveries: InMemoryDeliveriesRepository
let changes: InMemoryDeliveryChangesRepository

const courierId = new UniqueEntityID()

function makeDelivery(owner = courierId): Delivery {
  return Delivery.create({
    courierId: owner,
    customer: CustomerInfo.create({
      name: 'Maria',
      phone: '11999999999',
      address: 'Rua A, 100',
    }),
    items: [],
  })
}

describe('AppendDeliveryChangeSubscriber', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()
    DomainEvents.shouldRun = true

    deliveries = new InMemoryDeliveriesRepository()
    changes = new InMemoryDeliveryChangesRepository(
      new InMemorySyncStateRepository(),
    )

    // eslint-disable-next-line no-new
    new AppendDeliveryChangeSubscriber(changes)
  })

  it('cria a entrega gera um UPSERT para o courier', async () => {
    const delivery = makeDelivery()

    await deliveries.create(delivery)

    expect(changes.items).toHaveLength(1)
    expect(changes.items[0].type).toBe('UPSERT')
    expect(changes.items[0].courierId.equals(courierId)).toBe(true)
  })

  it('mudança de status gera UPSERT', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    delivery.markOutForDelivery()
    await deliveries.save(delivery)

    expect(changes.items).toHaveLength(2)
    expect(changes.items[1].type).toBe('UPSERT')
  })

  it('reatribuição gera REMOVE para o antigo e UPSERT para o novo', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    const newCourierId = new UniqueEntityID()
    delivery.assignTo(newCourierId)
    await deliveries.save(delivery)

    const [, remove, upsert] = changes.items
    expect(remove.type).toBe('REMOVE')
    expect(remove.courierId.equals(courierId)).toBe(true)
    expect(upsert.type).toBe('UPSERT')
    expect(upsert.courierId.equals(newCourierId)).toBe(true)
  })

  it('cancelamento termina com REMOVE', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    delivery.cancel('cliente desistiu')
    await deliveries.save(delivery)

    expect(changes.items[changes.items.length - 1].type).toBe('REMOVE')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/infrastructure/events/append-delivery-change.subscriber.spec.ts`
Expected: FAIL — `Failed to resolve import "@/infrastructure/events/append-delivery-change.subscriber"`

- [ ] **Step 3: Write minimal implementation**

```ts
import { Injectable } from '@nestjs/common'

import { EventHandler } from '@/core/events/event-handler'
import { DomainEvents } from '@/core/events/domain-events'
import { DeliveryChangesRepository } from '@/domain/delivery/application/repositories/delivery-changes-repository'
import { DeliveryAssignedEvent } from '@/domain/delivery/enterprise/events/delivery-assigned.event'
import { DeliveryCancelledEvent } from '@/domain/delivery/enterprise/events/delivery-cancelled.event'
import { DeliveryCreatedEvent } from '@/domain/delivery/enterprise/events/delivery-created.event'
import { DeliveryDetailsChangedEvent } from '@/domain/delivery/enterprise/events/delivery-details-changed.event'
import { DeliveryRatedEvent } from '@/domain/delivery/enterprise/events/delivery-rated.event'
import { DeliveryStatusChangedEvent } from '@/domain/delivery/enterprise/events/delivery-status-changed.event'

/**
 * Traduz evento de domínio em entrada do log de sincronização. É isto que faz
 * valer a regra de ouro do delta sync: nenhuma mudança de entrega existe sem
 * change correspondente, porque quem anuncia a mudança é o próprio agregado.
 */
@Injectable()
export class AppendDeliveryChangeSubscriber implements EventHandler {
  constructor(private readonly changes: DeliveryChangesRepository) {
    this.setupSubscriptions()
  }

  setupSubscriptions(): void {
    DomainEvents.register(
      this.onDeliveryCreated.bind(this),
      DeliveryCreatedEvent.name,
    )
    DomainEvents.register(
      this.onStatusChanged.bind(this),
      DeliveryStatusChangedEvent.name,
    )
    DomainEvents.register(
      this.onDetailsChanged.bind(this),
      DeliveryDetailsChangedEvent.name,
    )
    DomainEvents.register(this.onRated.bind(this), DeliveryRatedEvent.name)
    DomainEvents.register(
      this.onAssigned.bind(this),
      DeliveryAssignedEvent.name,
    )
    DomainEvents.register(
      this.onCancelled.bind(this),
      DeliveryCancelledEvent.name,
    )
  }

  private async onDeliveryCreated(event: DeliveryCreatedEvent): Promise<void> {
    await this.changes.append({
      type: 'UPSERT',
      deliveryId: event.deliveryId,
      courierId: event.courierId,
    })
  }

  private async onStatusChanged(
    event: DeliveryStatusChangedEvent,
  ): Promise<void> {
    await this.changes.append({
      type: 'UPSERT',
      deliveryId: event.deliveryId,
      courierId: event.courierId,
    })
  }

  private async onDetailsChanged(
    event: DeliveryDetailsChangedEvent,
  ): Promise<void> {
    await this.changes.append({
      type: 'UPSERT',
      deliveryId: event.deliveryId,
      courierId: event.courierId,
    })
  }

  private async onRated(event: DeliveryRatedEvent): Promise<void> {
    await this.changes.append({
      type: 'UPSERT',
      deliveryId: event.deliveryId,
      courierId: event.courierId,
    })
  }

  private async onAssigned(event: DeliveryAssignedEvent): Promise<void> {
    if (event.previousCourierId) {
      await this.changes.append({
        type: 'REMOVE',
        deliveryId: event.deliveryId,
        courierId: event.previousCourierId,
      })
    }

    await this.changes.append({
      type: 'UPSERT',
      deliveryId: event.deliveryId,
      courierId: event.courierId,
    })
  }

  private async onCancelled(event: DeliveryCancelledEvent): Promise<void> {
    await this.changes.append({
      type: 'REMOVE',
      deliveryId: event.deliveryId,
      courierId: event.courierId,
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/infrastructure/events/append-delivery-change.subscriber.spec.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test
git add src/infrastructure/events
git commit -m "feat(delivery): append sync changes from domain events"
```

---

### Task 12: `GetDeliverySnapshotUseCase`

**Files:**

- Create: `src/domain/delivery/application/use-cases/get-delivery-snapshot.ts`
- Test: `src/domain/delivery/application/use-cases/get-delivery-snapshot.spec.ts`

A âncora do protocolo: `currentVersion` é lido **antes** de buscar a página, para que qualquer mudança concorrente caia no delta posterior em vez de se perder entre as páginas.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvents } from '@/core/events/domain-events'
import { GetDeliverySnapshotUseCase } from '@/domain/delivery/application/use-cases/get-delivery-snapshot'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'
import { InMemorySyncStateRepository } from '@/infrastructure/database/in-memory/in-memory-sync-state-repository'

let deliveries: InMemoryDeliveriesRepository
let syncState: InMemorySyncStateRepository
let sut: GetDeliverySnapshotUseCase

const courierId = new UniqueEntityID()

function makeDelivery(owner = courierId): Delivery {
  return Delivery.create({
    courierId: owner,
    customer: CustomerInfo.create({
      name: 'Maria',
      phone: '11999999999',
      address: 'Rua A, 100',
    }),
    items: [],
  })
}

describe('GetDeliverySnapshotUseCase', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()

    deliveries = new InMemoryDeliveriesRepository()
    syncState = new InMemorySyncStateRepository()
    sut = new GetDeliverySnapshotUseCase(deliveries, syncState)
  })

  it('devolve a página e a versão âncora', async () => {
    await deliveries.create(makeDelivery())
    await deliveries.create(makeDelivery())

    const result = await sut.execute({
      courierId: courierId.toString(),
      limit: 10,
      withTotal: true,
    })

    expect(result.isRight()).toBe(true)
    if (result.isLeft()) return

    expect(result.value.deliveries).toHaveLength(2)
    expect(result.value.totalItems).toBe(2)
    expect(result.value.nextCursor).toBeUndefined()
    expect(result.value.currentVersion).toBe(0)
  })

  it('pagina por cursor', async () => {
    await deliveries.create(makeDelivery())
    await deliveries.create(makeDelivery())
    await deliveries.create(makeDelivery())

    const first = await sut.execute({
      courierId: courierId.toString(),
      limit: 2,
      withTotal: false,
    })

    if (first.isLeft()) throw new Error('snapshot falhou')

    expect(first.value.deliveries).toHaveLength(2)
    expect(first.value.nextCursor).toBeDefined()
    expect(first.value.totalItems).toBeUndefined()

    const second = await sut.execute({
      courierId: courierId.toString(),
      limit: 2,
      withTotal: false,
      cursor: first.value.nextCursor,
    })

    if (second.isLeft()) throw new Error('snapshot falhou')

    expect(second.value.deliveries).toHaveLength(1)
    expect(second.value.nextCursor).toBeUndefined()
  })

  it('não devolve entrega de outro courier', async () => {
    await deliveries.create(makeDelivery(new UniqueEntityID()))

    const result = await sut.execute({
      courierId: courierId.toString(),
      limit: 10,
      withTotal: false,
    })

    if (result.isLeft()) throw new Error('snapshot falhou')

    expect(result.value.deliveries).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/delivery/application/use-cases/get-delivery-snapshot.spec.ts`
Expected: FAIL — import não resolvido

- [ ] **Step 3: Write minimal implementation**

```ts
import { Injectable } from '@nestjs/common'

import { Either, right } from '@/core/either'
import { DeliveriesRepository } from '@/domain/delivery/application/repositories/deliveries-repository'
import { SyncStateRepository } from '@/domain/delivery/application/repositories/sync-state-repository'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'

export interface GetDeliverySnapshotUseCaseRequest {
  courierId: string
  limit: number
  withTotal: boolean
  cursor?: string
}

export type GetDeliverySnapshotUseCaseResponse = Either<
  never,
  {
    currentVersion: number
    totalItems?: number
    deliveries: Delivery[]
    nextCursor?: string
  }
>

@Injectable()
export class GetDeliverySnapshotUseCase {
  constructor(
    private readonly deliveries: DeliveriesRepository,
    private readonly syncState: SyncStateRepository,
  ) {}

  async execute({
    courierId,
    limit,
    withTotal,
    cursor,
  }: GetDeliverySnapshotUseCaseRequest): Promise<GetDeliverySnapshotUseCaseResponse> {
    // Âncora lida antes da página: o que mudar durante a paginação cai no delta.
    const currentVersion = await this.syncState.currentVersion()

    const rows = await this.deliveries.findManyByCourier({
      courierId,
      limit: limit + 1,
      cursor,
    })

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    const totalItems = withTotal
      ? await this.deliveries.countByCourier(courierId)
      : undefined

    return right({
      currentVersion,
      totalItems,
      deliveries: page,
      nextCursor: hasMore ? page[page.length - 1].id.toString() : undefined,
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/delivery/application/use-cases/get-delivery-snapshot.spec.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test
git add src/domain/delivery
git commit -m "feat(delivery): add delivery snapshot use case"
```

---

### Task 13: `PullDeliveryChangesUseCase`

**Files:**

- Create: `src/domain/delivery/application/use-cases/pull-delivery-changes.ts`
- Test: `src/domain/delivery/application/use-cases/pull-delivery-changes.spec.ts`

O coração do plano. Quatro comportamentos que o projeto de origem erra e aqui são testados: `nextVersion` como cursor real do lote, `hasMore`, `resyncRequired` e compactação por entrega.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvents } from '@/core/events/domain-events'
import { PullDeliveryChangesUseCase } from '@/domain/delivery/application/use-cases/pull-delivery-changes'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'
import { InMemoryDeliveryChangesRepository } from '@/infrastructure/database/in-memory/in-memory-delivery-changes-repository'
import { InMemorySyncStateRepository } from '@/infrastructure/database/in-memory/in-memory-sync-state-repository'
import { AppendDeliveryChangeSubscriber } from '@/infrastructure/events/append-delivery-change.subscriber'

let deliveries: InMemoryDeliveriesRepository
let changes: InMemoryDeliveryChangesRepository
let syncState: InMemorySyncStateRepository
let sut: PullDeliveryChangesUseCase

const courierId = new UniqueEntityID()

function makeDelivery(owner = courierId): Delivery {
  return Delivery.create({
    courierId: owner,
    customer: CustomerInfo.create({
      name: 'Maria',
      phone: '11999999999',
      address: 'Rua A, 100',
    }),
    items: [],
  })
}

describe('PullDeliveryChangesUseCase', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()
    DomainEvents.shouldRun = true

    deliveries = new InMemoryDeliveriesRepository()
    syncState = new InMemorySyncStateRepository()
    changes = new InMemoryDeliveryChangesRepository(syncState)

    // eslint-disable-next-line no-new
    new AppendDeliveryChangeSubscriber(changes)

    sut = new PullDeliveryChangesUseCase(changes, deliveries, syncState)
  })

  it('devolve lote vazio quando o cliente já está em dia', async () => {
    await deliveries.create(makeDelivery())

    const result = await sut.execute({
      courierId: courierId.toString(),
      sinceVersion: 1,
      limit: 10,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    expect(result.value.changes).toHaveLength(0)
    expect(result.value.hasMore).toBe(false)
    expect(result.value.nextVersion).toBe(1)
    expect(result.value.resyncRequired).toBe(false)
  })

  it('devolve UPSERT com a entrega inteira', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    const result = await sut.execute({
      courierId: courierId.toString(),
      sinceVersion: 0,
      limit: 10,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    expect(result.value.changes).toHaveLength(1)
    expect(result.value.changes[0].type).toBe('UPSERT')
    expect(result.value.changes[0].delivery?.id.equals(delivery.id)).toBe(true)
  })

  it('sinaliza hasMore e devolve nextVersion do lote, não currentVersion', async () => {
    for (let index = 0; index < 5; index += 1) {
      await deliveries.create(makeDelivery())
    }

    const result = await sut.execute({
      courierId: courierId.toString(),
      sinceVersion: 0,
      limit: 2,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    expect(result.value.nextVersion).toBe(2)
    expect(result.value.currentVersion).toBe(5)
    expect(result.value.hasMore).toBe(true)
  })

  it('compacta várias mudanças da mesma entrega em um UPSERT', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    delivery.markOutForDelivery()
    await deliveries.save(delivery)

    delivery.registerFailedAttempt('Ausente', new Date())
    await deliveries.save(delivery)

    const result = await sut.execute({
      courierId: courierId.toString(),
      sinceVersion: 0,
      limit: 10,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    expect(result.value.changes).toHaveLength(1)
    expect(result.value.changes[0].version).toBe(3)
  })

  it('pede resync quando o cursor do cliente está adiantado', async () => {
    const result = await sut.execute({
      courierId: courierId.toString(),
      sinceVersion: 99,
      limit: 10,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    expect(result.value.resyncRequired).toBe(true)
    expect(result.value.changes).toHaveLength(0)
  })

  it('degrada UPSERT para REMOVE quando a entrega saiu do escopo do courier', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    delivery.assignTo(new UniqueEntityID())
    await deliveries.save(delivery)

    const result = await sut.execute({
      courierId: courierId.toString(),
      sinceVersion: 0,
      limit: 10,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    expect(result.value.changes).toHaveLength(1)
    expect(result.value.changes[0].type).toBe('REMOVE')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/delivery/application/use-cases/pull-delivery-changes.spec.ts`
Expected: FAIL — import não resolvido

- [ ] **Step 3: Write minimal implementation**

```ts
import { Injectable } from '@nestjs/common'

import { Either, right } from '@/core/either'
import { DeliveriesRepository } from '@/domain/delivery/application/repositories/deliveries-repository'
import { DeliveryChangesRepository } from '@/domain/delivery/application/repositories/delivery-changes-repository'
import { SyncStateRepository } from '@/domain/delivery/application/repositories/sync-state-repository'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import {
  DeliveryChange,
  DeliveryChangeType,
} from '@/domain/delivery/enterprise/entities/delivery-change'

export interface PullDeliveryChangesUseCaseRequest {
  courierId: string
  sinceVersion: number
  limit: number
}

export interface DeliveryChangeView {
  type: DeliveryChangeType
  version: number
  deliveryId: string
  delivery?: Delivery
}

export type PullDeliveryChangesUseCaseResponse = Either<
  never,
  {
    currentVersion: number
    nextVersion: number
    hasMore: boolean
    minVersion: number
    resyncRequired: boolean
    changes: DeliveryChangeView[]
  }
>

@Injectable()
export class PullDeliveryChangesUseCase {
  constructor(
    private readonly changes: DeliveryChangesRepository,
    private readonly deliveries: DeliveriesRepository,
    private readonly syncState: SyncStateRepository,
  ) {}

  async execute({
    courierId,
    sinceVersion,
    limit,
  }: PullDeliveryChangesUseCaseRequest): Promise<PullDeliveryChangesUseCaseResponse> {
    const currentVersion = await this.syncState.currentVersion()
    const minVersion = await this.changes.minVersion()

    // Cursor velho demais (log podado) ou adiantado (restore/reset): o cliente
    // não tem como convergir por delta, precisa refazer o snapshot.
    if (sinceVersion > currentVersion || sinceVersion < minVersion) {
      return right({
        currentVersion,
        nextVersion: sinceVersion,
        hasMore: false,
        minVersion,
        resyncRequired: true,
        changes: [],
      })
    }

    const rows = await this.changes.findManyForCourierSince({
      courierId,
      sinceVersion,
      limit,
    })

    if (rows.length === 0) {
      return right({
        currentVersion,
        nextVersion: sinceVersion,
        hasMore: false,
        minVersion,
        resyncRequired: false,
        changes: [],
      })
    }

    // Cursor do lote é a maior versão lida — nunca currentVersion, senão o
    // cliente pula o que ficou acima do limite e nunca mais recebe.
    const nextVersion = rows[rows.length - 1].version
    const hasMore = await this.changes.hasChangesForCourierAfter(
      courierId,
      nextVersion,
    )

    const changes: DeliveryChangeView[] = []

    for (const row of this.compact(rows)) {
      changes.push(await this.toView(row, courierId))
    }

    return right({
      currentVersion,
      nextVersion,
      hasMore,
      minVersion,
      resyncRequired: false,
      changes,
    })
  }

  /** Mantém só a última mudança de cada entrega: o UPSERT carrega o estado atual. */
  private compact(rows: DeliveryChange[]): DeliveryChange[] {
    const lastByDelivery = new Map<string, DeliveryChange>()

    for (const row of rows) {
      lastByDelivery.set(row.deliveryId.toString(), row)
    }

    return [...lastByDelivery.values()].sort((a, b) => a.version - b.version)
  }

  private async toView(
    row: DeliveryChange,
    courierId: string,
  ): Promise<DeliveryChangeView> {
    const deliveryId = row.deliveryId.toString()

    if (row.type === 'REMOVE') {
      return { type: 'REMOVE', version: row.version, deliveryId }
    }

    const delivery = await this.deliveries.findById(deliveryId)

    const isOutOfScope =
      !delivery ||
      delivery.courierId.toString() !== courierId ||
      delivery.status.value === 'CANCELLED'

    if (isOutOfScope) {
      return { type: 'REMOVE', version: row.version, deliveryId }
    }

    return { type: 'UPSERT', version: row.version, deliveryId, delivery }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/delivery/application/use-cases/pull-delivery-changes.spec.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test
git add src/domain/delivery
git commit -m "feat(delivery): add pull delivery changes use case"
```

---

### Task 14: `PushDeliveryEventsUseCase`

**Files:**

- Create: `src/domain/delivery/application/use-cases/push-delivery-events.ts`
- Test: `src/domain/delivery/application/use-cases/push-delivery-events.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvents } from '@/core/events/domain-events'
import { PushDeliveryEventsUseCase } from '@/domain/delivery/application/use-cases/push-delivery-events'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'
import { InMemoryProcessedDeliveryEventsRepository } from '@/infrastructure/database/in-memory/in-memory-processed-delivery-events-repository'

let deliveries: InMemoryDeliveriesRepository
let processed: InMemoryProcessedDeliveryEventsRepository
let sut: PushDeliveryEventsUseCase

const courierId = new UniqueEntityID()

function makeDelivery(owner = courierId): Delivery {
  return Delivery.create({
    courierId: owner,
    customer: CustomerInfo.create({
      name: 'Maria',
      phone: '11999999999',
      address: 'Rua A, 100',
    }),
    items: [],
  })
}

describe('PushDeliveryEventsUseCase', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()

    deliveries = new InMemoryDeliveriesRepository()
    processed = new InMemoryProcessedDeliveryEventsRepository()
    sut = new PushDeliveryEventsUseCase(deliveries, processed)
  })

  it('aplica saída e entrega na ordem de occurredAt', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    const result = await sut.execute({
      courierId: courierId.toString(),
      events: [
        {
          clientEventId: 'evt-2',
          deliveryId: delivery.id.toString(),
          type: 'DELIVERED',
          occurredAt: new Date('2026-09-21T12:10:00.000Z'),
          receivedBy: 'Porteiro',
        },
        {
          clientEventId: 'evt-1',
          deliveryId: delivery.id.toString(),
          type: 'OUT_FOR_DELIVERY',
          occurredAt: new Date('2026-09-21T12:00:00.000Z'),
        },
      ],
    })

    if (result.isLeft()) throw new Error('push falhou')

    expect(result.value.results.map((item) => item.status)).toEqual([
      'APPLIED',
      'APPLIED',
    ])
    expect(deliveries.items[0].status.value).toBe('DELIVERED')
  })

  it('marca DUPLICATE no reenvio do mesmo clientEventId', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    const event = {
      clientEventId: 'evt-1',
      deliveryId: delivery.id.toString(),
      type: 'OUT_FOR_DELIVERY' as const,
      occurredAt: new Date(),
    }

    await sut.execute({ courierId: courierId.toString(), events: [event] })
    const second = await sut.execute({
      courierId: courierId.toString(),
      events: [event],
    })

    if (second.isLeft()) throw new Error('push falhou')

    expect(second.value.results[0].status).toBe('DUPLICATE')
    expect(deliveries.items[0].status.value).toBe('OUT_FOR_DELIVERY')
  })

  it('rejeita transição inválida sem derrubar o resto do lote', async () => {
    const first = makeDelivery()
    const second = makeDelivery()
    await deliveries.create(first)
    await deliveries.create(second)

    const result = await sut.execute({
      courierId: courierId.toString(),
      events: [
        {
          clientEventId: 'evt-1',
          deliveryId: first.id.toString(),
          type: 'DELIVERED',
          occurredAt: new Date(),
          receivedBy: 'Maria',
        },
        {
          clientEventId: 'evt-2',
          deliveryId: second.id.toString(),
          type: 'OUT_FOR_DELIVERY',
          occurredAt: new Date(),
        },
      ],
    })

    if (result.isLeft()) throw new Error('push falhou')

    expect(result.value.results[0].status).toBe('REJECTED')
    expect(result.value.results[0].code).toBe('INVALID_STATUS_TRANSITION')
    expect(result.value.results[0].delivery?.id.equals(first.id)).toBe(true)
    expect(result.value.results[1].status).toBe('APPLIED')
  })

  it('rejeita entrega cancelada com código próprio', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)
    delivery.cancel('operação cancelou')
    await deliveries.save(delivery)

    const result = await sut.execute({
      courierId: courierId.toString(),
      events: [
        {
          clientEventId: 'evt-1',
          deliveryId: delivery.id.toString(),
          type: 'OUT_FOR_DELIVERY',
          occurredAt: new Date(),
        },
      ],
    })

    if (result.isLeft()) throw new Error('push falhou')

    expect(result.value.results[0].code).toBe('DELIVERY_CANCELLED')
  })

  it('rejeita evento de entrega que já é de outro courier', async () => {
    const delivery = makeDelivery(new UniqueEntityID())
    await deliveries.create(delivery)

    const result = await sut.execute({
      courierId: courierId.toString(),
      events: [
        {
          clientEventId: 'evt-1',
          deliveryId: delivery.id.toString(),
          type: 'OUT_FOR_DELIVERY',
          occurredAt: new Date(),
        },
      ],
    })

    if (result.isLeft()) throw new Error('push falhou')

    expect(result.value.results[0].code).toBe('DELIVERY_REASSIGNED')
  })

  it('rejeita evento de entrega inexistente', async () => {
    const result = await sut.execute({
      courierId: courierId.toString(),
      events: [
        {
          clientEventId: 'evt-1',
          deliveryId: new UniqueEntityID().toString(),
          type: 'OUT_FOR_DELIVERY',
          occurredAt: new Date(),
        },
      ],
    })

    if (result.isLeft()) throw new Error('push falhou')

    expect(result.value.results[0].code).toBe('DELIVERY_NOT_FOUND')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/delivery/application/use-cases/push-delivery-events.spec.ts`
Expected: FAIL — import não resolvido

- [ ] **Step 3: Write minimal implementation**

```ts
import { Injectable } from '@nestjs/common'

import { Either, right } from '@/core/either'
import { DeliveriesRepository } from '@/domain/delivery/application/repositories/deliveries-repository'
import { ProcessedDeliveryEventsRepository } from '@/domain/delivery/application/repositories/processed-delivery-events-repository'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'

export type PushedDeliveryEventType =
  'OUT_FOR_DELIVERY' | 'FAILED_ATTEMPT' | 'DELIVERED'

export interface PushedDeliveryEvent {
  clientEventId: string
  deliveryId: string
  type: PushedDeliveryEventType
  occurredAt: Date
  reason?: string
  receivedBy?: string
}

export type PushDeliveryEventResultStatus = 'APPLIED' | 'DUPLICATE' | 'REJECTED'

export type PushDeliveryEventRejectionCode =
  | 'DELIVERY_NOT_FOUND'
  | 'DELIVERY_REASSIGNED'
  | 'DELIVERY_CANCELLED'
  | 'INVALID_STATUS_TRANSITION'

export interface PushDeliveryEventResult {
  clientEventId: string
  status: PushDeliveryEventResultStatus
  code?: PushDeliveryEventRejectionCode
  delivery?: Delivery
}

export interface PushDeliveryEventsUseCaseRequest {
  courierId: string
  events: PushedDeliveryEvent[]
}

export type PushDeliveryEventsUseCaseResponse = Either<
  never,
  { results: PushDeliveryEventResult[] }
>

@Injectable()
export class PushDeliveryEventsUseCase {
  constructor(
    private readonly deliveries: DeliveriesRepository,
    private readonly processed: ProcessedDeliveryEventsRepository,
  ) {}

  async execute({
    courierId,
    events,
  }: PushDeliveryEventsUseCaseRequest): Promise<PushDeliveryEventsUseCaseResponse> {
    const resultsByEventId = new Map<string, PushDeliveryEventResult>()

    for (const event of this.order(events)) {
      resultsByEventId.set(
        event.clientEventId,
        await this.applyOne(event, courierId),
      )
    }

    // A resposta sai na ordem em que o cliente enviou, para ele casar item a item.
    const results = events.map(
      (event) =>
        resultsByEventId.get(event.clientEventId) ?? {
          clientEventId: event.clientEventId,
          status: 'REJECTED' as const,
          code: 'DELIVERY_NOT_FOUND' as const,
        },
    )

    return right({ results })
  }

  /**
   * Eventos da mesma entrega são aplicados em ordem de relógio do dispositivo;
   * entregas diferentes mantêm a ordem de chegada no array.
   */
  private order(events: PushedDeliveryEvent[]): PushedDeliveryEvent[] {
    const groups = new Map<string, PushedDeliveryEvent[]>()

    for (const event of events) {
      const group = groups.get(event.deliveryId) ?? []
      group.push(event)
      groups.set(event.deliveryId, group)
    }

    return [...groups.values()].flatMap((group) =>
      [...group].sort(
        (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
      ),
    )
  }

  private async applyOne(
    event: PushedDeliveryEvent,
    courierId: string,
  ): Promise<PushDeliveryEventResult> {
    if (await this.processed.has(event.clientEventId)) {
      return { clientEventId: event.clientEventId, status: 'DUPLICATE' }
    }

    const delivery = await this.deliveries.findById(event.deliveryId)

    if (!delivery) {
      return {
        clientEventId: event.clientEventId,
        status: 'REJECTED',
        code: 'DELIVERY_NOT_FOUND',
      }
    }

    if (delivery.courierId.toString() !== courierId) {
      return {
        clientEventId: event.clientEventId,
        status: 'REJECTED',
        code: 'DELIVERY_REASSIGNED',
        delivery,
      }
    }

    if (delivery.status.value === 'CANCELLED') {
      return {
        clientEventId: event.clientEventId,
        status: 'REJECTED',
        code: 'DELIVERY_CANCELLED',
        delivery,
      }
    }

    const applied = this.applyToAggregate(delivery, event)

    if (applied.isLeft()) {
      return {
        clientEventId: event.clientEventId,
        status: 'REJECTED',
        code: 'INVALID_STATUS_TRANSITION',
        delivery,
      }
    }

    await this.deliveries.save(delivery)
    await this.processed.register(event.clientEventId)

    return { clientEventId: event.clientEventId, status: 'APPLIED', delivery }
  }

  private applyToAggregate(
    delivery: Delivery,
    event: PushedDeliveryEvent,
  ): Either<Error, null> {
    switch (event.type) {
      case 'OUT_FOR_DELIVERY':
        return delivery.markOutForDelivery(event.occurredAt)
      case 'FAILED_ATTEMPT':
        return delivery.registerFailedAttempt(
          event.reason ?? 'Não informado',
          event.occurredAt,
        )
      case 'DELIVERED':
        return delivery.markDelivered(
          event.receivedBy ?? 'Não informado',
          event.occurredAt,
        )
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/delivery/application/use-cases/push-delivery-events.spec.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test
git add src/domain/delivery
git commit -m "feat(delivery): add push delivery events use case"
```

---

### Task 15: `RateDeliveryUseCase`

**Files:**

- Create: `src/domain/delivery/application/use-cases/rate-delivery.ts`
- Test: `src/domain/delivery/application/use-cases/rate-delivery.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvents } from '@/core/events/domain-events'
import { DeliveryNotDeliveredError } from '@/domain/delivery/application/use-cases/delivery-not-delivered-error'
import { DeliveryNotFoundError } from '@/domain/delivery/application/use-cases/delivery-not-found-error'
import { InvalidRatingScoreError } from '@/domain/delivery/application/use-cases/invalid-rating-score-error'
import { RateDeliveryUseCase } from '@/domain/delivery/application/use-cases/rate-delivery'
import { RatingAlreadyExistsError } from '@/domain/delivery/application/use-cases/rating-already-exists-error'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'

let deliveries: InMemoryDeliveriesRepository
let sut: RateDeliveryUseCase

async function makeDeliveredDelivery(): Promise<Delivery> {
  const delivery = Delivery.create({
    courierId: new UniqueEntityID(),
    customer: CustomerInfo.create({
      name: 'Maria',
      phone: '11999999999',
      address: 'Rua A, 100',
    }),
    items: [],
  })

  delivery.markOutForDelivery()
  delivery.markDelivered('Maria', new Date())
  await deliveries.create(delivery)

  return delivery
}

describe('RateDeliveryUseCase', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()

    deliveries = new InMemoryDeliveriesRepository()
    sut = new RateDeliveryUseCase(deliveries)
  })

  it('avalia entrega entregue', async () => {
    const delivery = await makeDeliveredDelivery()

    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      score: 5,
      comment: 'Rápido',
    })

    expect(result.isRight()).toBe(true)
    expect(deliveries.items[0].rating?.score.value).toBe(5)
    expect(deliveries.items[0].rating?.comment).toBe('Rápido')
  })

  it('aceita nota sem comentário', async () => {
    const delivery = await makeDeliveredDelivery()

    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      score: 0,
      comment: null,
    })

    expect(result.isRight()).toBe(true)
    expect(deliveries.items[0].rating?.comment).toBeNull()
  })

  it('recusa nota fora da faixa', async () => {
    const delivery = await makeDeliveredDelivery()

    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      score: 9,
      comment: null,
    })

    expect(result.isLeft()).toBe(true)
    expect(result.value).toBeInstanceOf(InvalidRatingScoreError)
  })

  it('recusa entrega inexistente', async () => {
    const result = await sut.execute({
      deliveryId: new UniqueEntityID().toString(),
      score: 5,
      comment: null,
    })

    expect(result.value).toBeInstanceOf(DeliveryNotFoundError)
  })

  it('recusa entrega que ainda não foi entregue', async () => {
    const delivery = Delivery.create({
      courierId: new UniqueEntityID(),
      customer: CustomerInfo.create({
        name: 'Maria',
        phone: '11999999999',
        address: 'Rua A, 100',
      }),
      items: [],
    })
    await deliveries.create(delivery)

    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      score: 5,
      comment: null,
    })

    expect(result.value).toBeInstanceOf(DeliveryNotDeliveredError)
  })

  it('recusa avaliar duas vezes', async () => {
    const delivery = await makeDeliveredDelivery()

    await sut.execute({
      deliveryId: delivery.id.toString(),
      score: 5,
      comment: null,
    })
    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      score: 4,
      comment: null,
    })

    expect(result.value).toBeInstanceOf(RatingAlreadyExistsError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/delivery/application/use-cases/rate-delivery.spec.ts`
Expected: FAIL — import não resolvido

- [ ] **Step 3: Write minimal implementation**

```ts
import { Injectable } from '@nestjs/common'

import { Either, left, right } from '@/core/either'
import { DeliveriesRepository } from '@/domain/delivery/application/repositories/deliveries-repository'
import { DeliveryNotDeliveredError } from '@/domain/delivery/application/use-cases/delivery-not-delivered-error'
import { DeliveryNotFoundError } from '@/domain/delivery/application/use-cases/delivery-not-found-error'
import { InvalidRatingScoreError } from '@/domain/delivery/application/use-cases/invalid-rating-score-error'
import { RatingAlreadyExistsError } from '@/domain/delivery/application/use-cases/rating-already-exists-error'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { RatingScore } from '@/domain/delivery/enterprise/entities/rating-score'

export interface RateDeliveryUseCaseRequest {
  deliveryId: string
  score: number
  comment: string | null
}

export type RateDeliveryUseCaseResponse = Either<
  | InvalidRatingScoreError
  | DeliveryNotFoundError
  | DeliveryNotDeliveredError
  | RatingAlreadyExistsError,
  { delivery: Delivery }
>

@Injectable()
export class RateDeliveryUseCase {
  constructor(private readonly deliveries: DeliveriesRepository) {}

  async execute({
    deliveryId,
    score,
    comment,
  }: RateDeliveryUseCaseRequest): Promise<RateDeliveryUseCaseResponse> {
    const ratingScore = RatingScore.create(score)

    if (ratingScore.isLeft()) {
      return left(ratingScore.value)
    }

    const delivery = await this.deliveries.findById(deliveryId)

    if (!delivery) {
      return left(new DeliveryNotFoundError())
    }

    const rated = delivery.rate(ratingScore.value, comment)

    if (rated.isLeft()) {
      return left(rated.value)
    }

    await this.deliveries.save(delivery)

    return right({ delivery })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/delivery/application/use-cases/rate-delivery.spec.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test
git add src/domain/delivery
git commit -m "feat(delivery): add rate delivery use case"
```

---

### Task 16: `CreateDeliveryUseCase` e `UpdateDeliveryUseCase`

**Files:**

- Create: `src/domain/delivery/application/use-cases/create-delivery.ts`
- Create: `src/domain/delivery/application/use-cases/update-delivery.ts`
- Test: `src/domain/delivery/application/use-cases/create-delivery.spec.ts`
- Test: `src/domain/delivery/application/use-cases/update-delivery.spec.ts`

Produto inexistente devolve `ResourceNotFoundError` do `core`, que o mapeamento HTTP já traduz para 404.

- [ ] **Step 1: Write the failing tests**

`create-delivery.spec.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvents } from '@/core/events/domain-events'
import { ResourceNotFoundError } from '@/core/errors/resource-not-found-error'
import { CreateDeliveryUseCase } from '@/domain/delivery/application/use-cases/create-delivery'
import { InvalidQuantityError } from '@/domain/delivery/application/use-cases/invalid-quantity-error'
import { Product } from '@/domain/delivery/enterprise/entities/product'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'
import { InMemoryProductsRepository } from '@/infrastructure/database/in-memory/in-memory-products-repository'

let deliveries: InMemoryDeliveriesRepository
let products: InMemoryProductsRepository
let sut: CreateDeliveryUseCase

const productId = new UniqueEntityID()
const customer = {
  name: 'Maria',
  phone: '11999999999',
  address: 'Rua A, 100',
}

describe('CreateDeliveryUseCase', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()

    deliveries = new InMemoryDeliveriesRepository()
    products = new InMemoryProductsRepository()
    products.items.push(
      Product.create({ name: 'Café', priceCents: 1990 }, productId),
    )

    sut = new CreateDeliveryUseCase(deliveries, products)
  })

  it('cria a entrega com snapshot de nome e preço do produto', async () => {
    const result = await sut.execute({
      courierId: new UniqueEntityID().toString(),
      customer,
      items: [{ productId: productId.toString(), quantity: 2 }],
    })

    expect(result.isRight()).toBe(true)
    if (result.isLeft()) return

    expect(result.value.delivery.items).toHaveLength(1)
    expect(result.value.delivery.items[0].productName).toBe('Café')
    expect(result.value.delivery.totalCents).toBe(3980)
    expect(deliveries.items).toHaveLength(1)
  })

  it('recusa produto inexistente', async () => {
    const result = await sut.execute({
      courierId: new UniqueEntityID().toString(),
      customer,
      items: [{ productId: new UniqueEntityID().toString(), quantity: 1 }],
    })

    expect(result.value).toBeInstanceOf(ResourceNotFoundError)
  })

  it('recusa quantidade inválida', async () => {
    const result = await sut.execute({
      courierId: new UniqueEntityID().toString(),
      customer,
      items: [{ productId: productId.toString(), quantity: 0 }],
    })

    expect(result.value).toBeInstanceOf(InvalidQuantityError)
  })
})
```

`update-delivery.spec.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvents } from '@/core/events/domain-events'
import { DeliveryAlreadyFinalizedError } from '@/domain/delivery/application/use-cases/delivery-already-finalized-error'
import { DeliveryNotFoundError } from '@/domain/delivery/application/use-cases/delivery-not-found-error'
import { UpdateDeliveryUseCase } from '@/domain/delivery/application/use-cases/update-delivery'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { Product } from '@/domain/delivery/enterprise/entities/product'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'
import { InMemoryProductsRepository } from '@/infrastructure/database/in-memory/in-memory-products-repository'

let deliveries: InMemoryDeliveriesRepository
let products: InMemoryProductsRepository
let sut: UpdateDeliveryUseCase

const productId = new UniqueEntityID()

async function makeDelivery(): Promise<Delivery> {
  const delivery = Delivery.create({
    courierId: new UniqueEntityID(),
    customer: CustomerInfo.create({
      name: 'Maria',
      phone: '11999999999',
      address: 'Rua A, 100',
    }),
    items: [],
  })

  await deliveries.create(delivery)

  return delivery
}

describe('UpdateDeliveryUseCase', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()

    deliveries = new InMemoryDeliveriesRepository()
    products = new InMemoryProductsRepository()
    products.items.push(
      Product.create({ name: 'Café', priceCents: 1990 }, productId),
    )

    sut = new UpdateDeliveryUseCase(deliveries, products)
  })

  it('troca os dados do cliente', async () => {
    const delivery = await makeDelivery()

    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      customer: {
        name: 'Maria',
        phone: '11999999999',
        address: 'Rua Nova, 500',
      },
    })

    expect(result.isRight()).toBe(true)
    expect(deliveries.items[0].customer.address).toBe('Rua Nova, 500')
  })

  it('troca os itens', async () => {
    const delivery = await makeDelivery()

    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      items: [{ productId: productId.toString(), quantity: 3 }],
    })

    expect(result.isRight()).toBe(true)
    expect(deliveries.items[0].totalCents).toBe(5970)
  })

  it('reatribui para outro courier', async () => {
    const delivery = await makeDelivery()
    const newCourierId = new UniqueEntityID().toString()

    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      courierId: newCourierId,
    })

    expect(result.isRight()).toBe(true)
    expect(deliveries.items[0].courierId.toString()).toBe(newCourierId)
  })

  it('cancela a entrega', async () => {
    const delivery = await makeDelivery()

    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      cancelReason: 'cliente desistiu',
    })

    expect(result.isRight()).toBe(true)
    expect(deliveries.items[0].status.value).toBe('CANCELLED')
  })

  it('recusa alterar entrega finalizada', async () => {
    const delivery = await makeDelivery()
    delivery.cancel('já era')
    await deliveries.save(delivery)

    const result = await sut.execute({
      deliveryId: delivery.id.toString(),
      items: [{ productId: productId.toString(), quantity: 1 }],
    })

    expect(result.value).toBeInstanceOf(DeliveryAlreadyFinalizedError)
  })

  it('recusa entrega inexistente', async () => {
    const result = await sut.execute({
      deliveryId: new UniqueEntityID().toString(),
      cancelReason: 'nada',
    })

    expect(result.value).toBeInstanceOf(DeliveryNotFoundError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/domain/delivery/application/use-cases/create-delivery.spec.ts src/domain/delivery/application/use-cases/update-delivery.spec.ts`
Expected: FAIL — imports não resolvidos

- [ ] **Step 3: Write minimal implementation**

`create-delivery.ts`:

```ts
import { Injectable } from '@nestjs/common'

import { Either, left, right } from '@/core/either'
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { ResourceNotFoundError } from '@/core/errors/resource-not-found-error'
import { DeliveriesRepository } from '@/domain/delivery/application/repositories/deliveries-repository'
import { ProductsRepository } from '@/domain/delivery/application/repositories/products-repository'
import { InvalidQuantityError } from '@/domain/delivery/application/use-cases/invalid-quantity-error'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { DeliveryItem } from '@/domain/delivery/enterprise/entities/delivery-item'
import { Quantity } from '@/domain/delivery/enterprise/entities/quantity'

export interface DeliveryItemInput {
  productId: string
  quantity: number
}

export interface CreateDeliveryUseCaseRequest {
  courierId: string
  customer: { name: string; phone: string; address: string }
  items: DeliveryItemInput[]
}

export type CreateDeliveryUseCaseResponse = Either<
  ResourceNotFoundError | InvalidQuantityError,
  { delivery: Delivery }
>

@Injectable()
export class CreateDeliveryUseCase {
  constructor(
    private readonly deliveries: DeliveriesRepository,
    private readonly products: ProductsRepository,
  ) {}

  async execute({
    courierId,
    customer,
    items,
  }: CreateDeliveryUseCaseRequest): Promise<CreateDeliveryUseCaseResponse> {
    const built = await buildItems(this.products, items)

    if (built.isLeft()) {
      return left(built.value)
    }

    const delivery = Delivery.create({
      courierId: new UniqueEntityID(courierId),
      customer: CustomerInfo.create(customer),
      items: built.value,
    })

    await this.deliveries.create(delivery)

    return right({ delivery })
  }
}

/** Resolve produtos e quantidades. Compartilhado com o UpdateDeliveryUseCase. */
export async function buildItems(
  products: ProductsRepository,
  items: DeliveryItemInput[],
): Promise<
  Either<ResourceNotFoundError | InvalidQuantityError, DeliveryItem[]>
> {
  const built: DeliveryItem[] = []

  for (const item of items) {
    const product = await products.findById(item.productId)

    if (!product) {
      return left(new ResourceNotFoundError())
    }

    const quantity = Quantity.create(item.quantity)

    if (quantity.isLeft()) {
      return left(quantity.value)
    }

    built.push(DeliveryItem.fromProduct(product, quantity.value))
  }

  return right(built)
}
```

`update-delivery.ts`:

```ts
import { Injectable } from '@nestjs/common'

import { Either, left, right } from '@/core/either'
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { ResourceNotFoundError } from '@/core/errors/resource-not-found-error'
import { DeliveriesRepository } from '@/domain/delivery/application/repositories/deliveries-repository'
import { ProductsRepository } from '@/domain/delivery/application/repositories/products-repository'
import {
  buildItems,
  DeliveryItemInput,
} from '@/domain/delivery/application/use-cases/create-delivery'
import { DeliveryAlreadyFinalizedError } from '@/domain/delivery/application/use-cases/delivery-already-finalized-error'
import { DeliveryNotFoundError } from '@/domain/delivery/application/use-cases/delivery-not-found-error'
import { InvalidQuantityError } from '@/domain/delivery/application/use-cases/invalid-quantity-error'
import { InvalidStatusTransitionError } from '@/domain/delivery/application/use-cases/invalid-status-transition-error'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'

export interface UpdateDeliveryUseCaseRequest {
  deliveryId: string
  courierId?: string
  customer?: { name: string; phone: string; address: string }
  items?: DeliveryItemInput[]
  cancelReason?: string
}

export type UpdateDeliveryUseCaseResponse = Either<
  | DeliveryNotFoundError
  | DeliveryAlreadyFinalizedError
  | InvalidStatusTransitionError
  | ResourceNotFoundError
  | InvalidQuantityError,
  { delivery: Delivery }
>

@Injectable()
export class UpdateDeliveryUseCase {
  constructor(
    private readonly deliveries: DeliveriesRepository,
    private readonly products: ProductsRepository,
  ) {}

  async execute({
    deliveryId,
    courierId,
    customer,
    items,
    cancelReason,
  }: UpdateDeliveryUseCaseRequest): Promise<UpdateDeliveryUseCaseResponse> {
    const delivery = await this.deliveries.findById(deliveryId)

    if (!delivery) {
      return left(new DeliveryNotFoundError())
    }

    if (items) {
      const built = await buildItems(this.products, items)

      if (built.isLeft()) {
        return left(built.value)
      }

      const changed = delivery.changeItems(built.value)

      if (changed.isLeft()) {
        return left(changed.value)
      }
    }

    if (customer) {
      const changed = delivery.changeCustomer(CustomerInfo.create(customer))

      if (changed.isLeft()) {
        return left(changed.value)
      }
    }

    if (courierId) {
      const assigned = delivery.assignTo(new UniqueEntityID(courierId))

      if (assigned.isLeft()) {
        return left(assigned.value)
      }
    }

    if (cancelReason) {
      const cancelled = delivery.cancel(cancelReason)

      if (cancelled.isLeft()) {
        return left(cancelled.value)
      }
    }

    await this.deliveries.save(delivery)

    return right({ delivery })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/domain/delivery/application/use-cases/create-delivery.spec.ts src/domain/delivery/application/use-cases/update-delivery.spec.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test
git add src/domain/delivery
git commit -m "feat(delivery): add create and update delivery use cases"
```

---

### Task 17: Presenters e mapeamento de erro para HTTP

**Files:**

- Create: `src/infrastructure/http/presenters/delivery-presenter.ts`
- Modify: `src/infrastructure/http/errors/use-case-error-to-http.ts`
- Test: `src/infrastructure/http/presenters/delivery-presenter.spec.ts`
- Test: `src/infrastructure/http/errors/use-case-error-to-http.spec.ts` (já existe — adicionar casos)

- [ ] **Step 1: Write the failing test**

`delivery-presenter.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { DeliveryItem } from '@/domain/delivery/enterprise/entities/delivery-item'
import { Product } from '@/domain/delivery/enterprise/entities/product'
import { Quantity } from '@/domain/delivery/enterprise/entities/quantity'
import { RatingScore } from '@/domain/delivery/enterprise/entities/rating-score'
import { DeliveryPresenter } from '@/infrastructure/http/presenters/delivery-presenter'

function makeDelivery(): Delivery {
  const quantity = Quantity.create(2)
  if (quantity.isLeft()) throw new Error('quantity inválida no setup')

  return Delivery.create({
    courierId: new UniqueEntityID(),
    customer: CustomerInfo.create({
      name: 'Maria',
      phone: '11999999999',
      address: 'Rua A, 100',
    }),
    items: [
      DeliveryItem.fromProduct(
        Product.create({ name: 'Café', priceCents: 1990 }),
        quantity.value,
      ),
    ],
  })
}

describe('DeliveryPresenter', () => {
  it('serializa a entrega sem vazar objetos de domínio', () => {
    const http = DeliveryPresenter.toHTTP(makeDelivery())

    expect(http.status).toBe('PENDING')
    expect(http.items[0]).toEqual({
      productId: expect.any(String),
      productName: 'Café',
      unitPriceCents: 1990,
      quantity: 2,
    })
    expect(http.totalCents).toBe(3980)
    expect(http.rating).toBeNull()
    expect(typeof http.createdAt).toBe('string')
  })

  it('serializa a avaliação quando existe', () => {
    const delivery = makeDelivery()
    delivery.markOutForDelivery()
    delivery.markDelivered('Maria', new Date())

    const score = RatingScore.create(4)
    if (score.isLeft()) throw new Error('score inválido no setup')

    delivery.rate(score.value, 'Bom')

    const http = DeliveryPresenter.toHTTP(delivery)

    expect(http.rating).toEqual({
      score: 4,
      comment: 'Bom',
      ratedAt: expect.any(String),
    })
  })
})
```

Adicionar ao `use-case-error-to-http.spec.ts` existente:

```ts
it('mapeia os erros de entrega para os status corretos', () => {
  expect(useCaseErrorToHttp(new DeliveryNotFoundError())).toBeInstanceOf(
    NotFoundException,
  )
  expect(useCaseErrorToHttp(new CourierMismatchError())).toBeInstanceOf(
    ForbiddenException,
  )
  expect(
    useCaseErrorToHttp(
      new InvalidStatusTransitionError('PENDING', 'DELIVERED'),
    ),
  ).toBeInstanceOf(ConflictException)
  expect(
    useCaseErrorToHttp(new DeliveryAlreadyFinalizedError()),
  ).toBeInstanceOf(ConflictException)
  expect(useCaseErrorToHttp(new DeliveryNotDeliveredError())).toBeInstanceOf(
    ConflictException,
  )
  expect(useCaseErrorToHttp(new RatingAlreadyExistsError())).toBeInstanceOf(
    ConflictException,
  )
  expect(useCaseErrorToHttp(new InvalidRatingScoreError(9))).toBeInstanceOf(
    UnprocessableEntityException,
  )
  expect(useCaseErrorToHttp(new InvalidQuantityError(0))).toBeInstanceOf(
    UnprocessableEntityException,
  )
})
```

com os imports correspondentes de `@nestjs/common` (`ConflictException`, `ForbiddenException`, `UnprocessableEntityException`) e dos erros de `@/domain/delivery/application/use-cases/*`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/infrastructure/http`
Expected: FAIL — `DeliveryPresenter` não existe e os erros novos caem no 500 genérico

- [ ] **Step 3: Write minimal implementation**

`delivery-presenter.ts`:

```ts
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
```

Substituir o `switch` de `use-case-error-to-http.ts` por:

```ts
switch (error.constructor) {
  case ResourceNotFoundError:
  case DeliveryNotFoundError:
    return new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message })
  case NotAllowedError:
    return new UnauthorizedException({ code: 'NOT_ALLOWED', message })
  case CourierMismatchError:
    return new ForbiddenException({ code: 'COURIER_MISMATCH', message })
  case InvalidStatusTransitionError:
    return new ConflictException({
      code: 'INVALID_STATUS_TRANSITION',
      message,
    })
  case DeliveryAlreadyFinalizedError:
    return new ConflictException({
      code: 'DELIVERY_ALREADY_FINALIZED',
      message,
    })
  case DeliveryNotDeliveredError:
    return new ConflictException({ code: 'DELIVERY_NOT_DELIVERED', message })
  case RatingAlreadyExistsError:
    return new ConflictException({ code: 'RATING_ALREADY_EXISTS', message })
  case InvalidRatingScoreError:
    return new UnprocessableEntityException({
      code: 'INVALID_RATING_SCORE',
      message,
    })
  case InvalidQuantityError:
    return new UnprocessableEntityException({
      code: 'INVALID_QUANTITY',
      message,
    })
  default:
    return new InternalServerErrorException({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    })
}
```

com os imports adicionais de `@nestjs/common` (`ConflictException`, `ForbiddenException`, `UnprocessableEntityException`) e dos oito erros de entrega.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/infrastructure/http`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test
git add src/infrastructure/http
git commit -m "feat(delivery): add delivery presenter and http error mapping"
```

---

### Task 18: Controllers, seed de produtos e wiring dos módulos

**Files:**

- Create: `src/infrastructure/database/in-memory/products.seed.ts`
- Create: `src/infrastructure/http/controllers/get-delivery-snapshot.controller.ts`
- Create: `src/infrastructure/http/controllers/pull-delivery-changes.controller.ts`
- Create: `src/infrastructure/http/controllers/push-delivery-events.controller.ts`
- Create: `src/infrastructure/http/controllers/rate-delivery.controller.ts`
- Create: `src/infrastructure/http/controllers/create-delivery.controller.ts`
- Create: `src/infrastructure/http/controllers/update-delivery.controller.ts`
- Modify: `src/infrastructure/database/database.module.ts`
- Modify: `src/infrastructure/http/http.module.ts`

- [ ] **Step 1: Write the failing test**

Este task é wiring; o teste que o valida é o e2e mínimo já existente mais um novo caso. Adicionar a `test/e2e/app.e2e-spec.ts`:

```ts
it('GET /couriers/:courierId/deliveries/snapshot responde com a âncora de versão', async () => {
  const response = await request(httpServer)
    .get('/couriers/3f2504e0-4f89-11d3-9a0c-0305e82c3301/deliveries/snapshot')
    .expect(200)

  const body = response.body as { currentVersion: number; deliveries: [] }
  expect(body.currentVersion).toBe(0)
  expect(body.deliveries).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL — 404, a rota ainda não existe

- [ ] **Step 3: Write minimal implementation**

`products.seed.ts`:

```ts
import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { Product } from '@/domain/delivery/enterprise/entities/product'
import { InMemoryProductsRepository } from '@/infrastructure/database/in-memory/in-memory-products-repository'

export const SEEDED_PRODUCT_IDS = {
  coffee: 'b6f0b4c2-0000-4000-8000-000000000001',
  mug: 'b6f0b4c2-0000-4000-8000-000000000002',
  filter: 'b6f0b4c2-0000-4000-8000-000000000003',
} as const

export function seedProducts(
  repository: InMemoryProductsRepository,
): InMemoryProductsRepository {
  repository.items.push(
    Product.create(
      { name: 'Café torrado 500g', priceCents: 3990 },
      new UniqueEntityID(SEEDED_PRODUCT_IDS.coffee),
    ),
    Product.create(
      { name: 'Caneca cerâmica', priceCents: 2490 },
      new UniqueEntityID(SEEDED_PRODUCT_IDS.mug),
    ),
    Product.create(
      { name: 'Filtro de papel', priceCents: 990 },
      new UniqueEntityID(SEEDED_PRODUCT_IDS.filter),
    ),
  )

  return repository
}
```

`get-delivery-snapshot.controller.ts`:

```ts
import { Controller, Get, Param, Query } from '@nestjs/common'
import { z } from 'zod'

import { GetDeliverySnapshotUseCase } from '@/domain/delivery/application/use-cases/get-delivery-snapshot'
import { useCaseErrorToHttp } from '@/infrastructure/http/errors/use-case-error-to-http'
import { DeliveryPresenter } from '@/infrastructure/http/presenters/delivery-presenter'
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

@Controller('/couriers/:courierId/deliveries/snapshot')
export class GetDeliverySnapshotController {
  constructor(private readonly getSnapshot: GetDeliverySnapshotUseCase) {}

  @Get()
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
```

`pull-delivery-changes.controller.ts`:

```ts
import { Controller, Get, Param, Query } from '@nestjs/common'
import { z } from 'zod'

import { PullDeliveryChangesUseCase } from '@/domain/delivery/application/use-cases/pull-delivery-changes'
import { useCaseErrorToHttp } from '@/infrastructure/http/errors/use-case-error-to-http'
import { DeliveryPresenter } from '@/infrastructure/http/presenters/delivery-presenter'
import { ZodValidationPipe } from '@/infrastructure/validation/zod-validation.pipe'

const changesQuerySchema = z.object({
  sinceVersion: z.coerce.number().int().min(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

type ChangesQuery = z.infer<typeof changesQuerySchema>

@Controller('/couriers/:courierId/deliveries/changes')
export class PullDeliveryChangesController {
  constructor(private readonly pullChanges: PullDeliveryChangesUseCase) {}

  @Get()
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
      changes: result.value.changes.map((change) => ({
        type: change.type,
        version: change.version,
        deliveryId: change.deliveryId,
        delivery: change.delivery
          ? DeliveryPresenter.toHTTP(change.delivery)
          : undefined,
      })),
    }
  }
}
```

`push-delivery-events.controller.ts`:

```ts
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common'
import { z } from 'zod'

import { PushDeliveryEventsUseCase } from '@/domain/delivery/application/use-cases/push-delivery-events'
import { useCaseErrorToHttp } from '@/infrastructure/http/errors/use-case-error-to-http'
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
```

`rate-delivery.controller.ts`:

```ts
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common'
import { z } from 'zod'

import { RateDeliveryUseCase } from '@/domain/delivery/application/use-cases/rate-delivery'
import { useCaseErrorToHttp } from '@/infrastructure/http/errors/use-case-error-to-http'
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
```

`create-delivery.controller.ts`:

```ts
import { Body, Controller, HttpCode, Post } from '@nestjs/common'
import { z } from 'zod'

import { CreateDeliveryUseCase } from '@/domain/delivery/application/use-cases/create-delivery'
import { useCaseErrorToHttp } from '@/infrastructure/http/errors/use-case-error-to-http'
import { DeliveryPresenter } from '@/infrastructure/http/presenters/delivery-presenter'
import { ZodValidationPipe } from '@/infrastructure/validation/zod-validation.pipe'

const createDeliveryBodySchema = z.object({
  courierId: z.string().uuid(),
  customer: z.object({
    name: z.string().min(1).max(120),
    phone: z.string().min(8).max(20),
    address: z.string().min(1).max(200),
  }),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1),
      }),
    )
    .min(1),
})

type CreateDeliveryBody = z.infer<typeof createDeliveryBodySchema>

@Controller('/deliveries')
export class CreateDeliveryController {
  constructor(private readonly createDelivery: CreateDeliveryUseCase) {}

  @Post()
  @HttpCode(201)
  async handle(
    @Body(new ZodValidationPipe(createDeliveryBodySchema))
    body: CreateDeliveryBody,
  ) {
    const result = await this.createDelivery.execute(body)

    if (result.isLeft()) {
      throw useCaseErrorToHttp(result.value)
    }

    return { delivery: DeliveryPresenter.toHTTP(result.value.delivery) }
  }
}
```

`update-delivery.controller.ts`:

```ts
import { Body, Controller, Param, Patch } from '@nestjs/common'
import { z } from 'zod'

import { UpdateDeliveryUseCase } from '@/domain/delivery/application/use-cases/update-delivery'
import { useCaseErrorToHttp } from '@/infrastructure/http/errors/use-case-error-to-http'
import { DeliveryPresenter } from '@/infrastructure/http/presenters/delivery-presenter'
import { ZodValidationPipe } from '@/infrastructure/validation/zod-validation.pipe'

const updateDeliveryBodySchema = z.object({
  courierId: z.string().uuid().optional(),
  customer: z
    .object({
      name: z.string().min(1).max(120),
      phone: z.string().min(8).max(20),
      address: z.string().min(1).max(200),
    })
    .optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1),
      }),
    )
    .optional(),
  cancelReason: z.string().min(1).max(200).optional(),
})

type UpdateDeliveryBody = z.infer<typeof updateDeliveryBodySchema>

@Controller('/deliveries/:deliveryId')
export class UpdateDeliveryController {
  constructor(private readonly updateDelivery: UpdateDeliveryUseCase) {}

  @Patch()
  async handle(
    @Param('deliveryId') deliveryId: string,
    @Body(new ZodValidationPipe(updateDeliveryBodySchema))
    body: UpdateDeliveryBody,
  ) {
    const result = await this.updateDelivery.execute({ deliveryId, ...body })

    if (result.isLeft()) {
      throw useCaseErrorToHttp(result.value)
    }

    return { delivery: DeliveryPresenter.toHTTP(result.value.delivery) }
  }
}
```

`database.module.ts` (substituir o conteúdo):

```ts
import { Global, Module } from '@nestjs/common'

import { DeliveriesRepository } from '@/domain/delivery/application/repositories/deliveries-repository'
import { DeliveryChangesRepository } from '@/domain/delivery/application/repositories/delivery-changes-repository'
import { ProcessedDeliveryEventsRepository } from '@/domain/delivery/application/repositories/processed-delivery-events-repository'
import { ProductsRepository } from '@/domain/delivery/application/repositories/products-repository'
import { SyncStateRepository } from '@/domain/delivery/application/repositories/sync-state-repository'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'
import { InMemoryDeliveryChangesRepository } from '@/infrastructure/database/in-memory/in-memory-delivery-changes-repository'
import { InMemoryProcessedDeliveryEventsRepository } from '@/infrastructure/database/in-memory/in-memory-processed-delivery-events-repository'
import { InMemoryProductsRepository } from '@/infrastructure/database/in-memory/in-memory-products-repository'
import { InMemorySyncStateRepository } from '@/infrastructure/database/in-memory/in-memory-sync-state-repository'
import { seedProducts } from '@/infrastructure/database/in-memory/products.seed'

@Global()
@Module({
  providers: [
    InMemorySyncStateRepository,
    InMemoryDeliveryChangesRepository,
    InMemoryDeliveriesRepository,
    InMemoryProcessedDeliveryEventsRepository,
    {
      provide: InMemoryProductsRepository,
      useFactory: () => seedProducts(new InMemoryProductsRepository()),
    },
    { provide: SyncStateRepository, useExisting: InMemorySyncStateRepository },
    {
      provide: DeliveryChangesRepository,
      useExisting: InMemoryDeliveryChangesRepository,
    },
    {
      provide: DeliveriesRepository,
      useExisting: InMemoryDeliveriesRepository,
    },
    { provide: ProductsRepository, useExisting: InMemoryProductsRepository },
    {
      provide: ProcessedDeliveryEventsRepository,
      useExisting: InMemoryProcessedDeliveryEventsRepository,
    },
  ],
  exports: [
    SyncStateRepository,
    DeliveryChangesRepository,
    DeliveriesRepository,
    ProductsRepository,
    ProcessedDeliveryEventsRepository,
  ],
})
export class DatabaseModule {}
```

`http.module.ts` (substituir o conteúdo):

```ts
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
```

Atenção à ordem dos controllers: `UpdateDeliveryController` usa a rota `/deliveries/:deliveryId` e precisa ser registrado **depois** de `CreateDeliveryController`, senão `POST /deliveries` não casa.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test && npm run test:e2e
git add src/infrastructure test/e2e
git commit -m "feat(delivery): add controllers, product seed and module wiring"
```

---

### Task 19: Testes do protocolo de sincronização

**Files:**

- Create: `test/sync-protocol/delta-sync.spec.ts`
- Modify: `vitest.config.mts`

É o teste que dá sentido ao projeto: prova que um cliente que segue o protocolo converge, incluindo o cenário que o projeto de origem perde em silêncio.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'

import { UniqueEntityID } from '@/core/entities/unique-entity-id'
import { DomainEvents } from '@/core/events/domain-events'
import { GetDeliverySnapshotUseCase } from '@/domain/delivery/application/use-cases/get-delivery-snapshot'
import { PullDeliveryChangesUseCase } from '@/domain/delivery/application/use-cases/pull-delivery-changes'
import { PushDeliveryEventsUseCase } from '@/domain/delivery/application/use-cases/push-delivery-events'
import { CustomerInfo } from '@/domain/delivery/enterprise/entities/customer-info'
import { Delivery } from '@/domain/delivery/enterprise/entities/delivery'
import { InMemoryDeliveriesRepository } from '@/infrastructure/database/in-memory/in-memory-deliveries-repository'
import { InMemoryDeliveryChangesRepository } from '@/infrastructure/database/in-memory/in-memory-delivery-changes-repository'
import { InMemoryProcessedDeliveryEventsRepository } from '@/infrastructure/database/in-memory/in-memory-processed-delivery-events-repository'
import { InMemorySyncStateRepository } from '@/infrastructure/database/in-memory/in-memory-sync-state-repository'
import { AppendDeliveryChangeSubscriber } from '@/infrastructure/events/append-delivery-change.subscriber'

let deliveries: InMemoryDeliveriesRepository
let changes: InMemoryDeliveryChangesRepository
let syncState: InMemorySyncStateRepository
let processed: InMemoryProcessedDeliveryEventsRepository
let pull: PullDeliveryChangesUseCase
let snapshot: GetDeliverySnapshotUseCase
let push: PushDeliveryEventsUseCase

const courierId = new UniqueEntityID()

function makeDelivery(owner = courierId): Delivery {
  return Delivery.create({
    courierId: owner,
    customer: CustomerInfo.create({
      name: 'Maria',
      phone: '11999999999',
      address: 'Rua A, 100',
    }),
    items: [],
  })
}

/** Cliente de referência: aplica o delta como o app deve aplicar. */
async function syncClient(startVersion: number, limit: number) {
  const cache = new Map<string, unknown>()
  let cursor = startVersion
  let rounds = 0

  for (;;) {
    const result = await pull.execute({
      courierId: courierId.toString(),
      sinceVersion: cursor,
      limit,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    rounds += 1

    for (const change of result.value.changes) {
      if (change.type === 'REMOVE') {
        cache.delete(change.deliveryId)
      } else {
        cache.set(change.deliveryId, change.delivery)
      }
    }

    cursor = result.value.nextVersion

    if (!result.value.hasMore) {
      return {
        cache,
        cursor,
        rounds,
        resyncRequired: result.value.resyncRequired,
      }
    }
  }
}

describe('protocolo de delta sync', () => {
  beforeEach(() => {
    DomainEvents.clearHandlers()
    DomainEvents.clearMarkedAggregates()
    DomainEvents.shouldRun = true

    deliveries = new InMemoryDeliveriesRepository()
    syncState = new InMemorySyncStateRepository()
    changes = new InMemoryDeliveryChangesRepository(syncState)
    processed = new InMemoryProcessedDeliveryEventsRepository()

    // eslint-disable-next-line no-new
    new AppendDeliveryChangeSubscriber(changes)

    pull = new PullDeliveryChangesUseCase(changes, deliveries, syncState)
    snapshot = new GetDeliverySnapshotUseCase(deliveries, syncState)
    push = new PushDeliveryEventsUseCase(deliveries, processed)
  })

  it('1. delta truncado não perde mudança: cliente itera até hasMore ser falso', async () => {
    for (let index = 0; index < 120; index += 1) {
      await deliveries.create(makeDelivery())
    }

    const client = await syncClient(0, 10)

    expect(client.cache.size).toBe(120)
    expect(client.rounds).toBeGreaterThan(1)
    expect(client.cursor).toBe(await syncState.currentVersion())
  })

  it('2. cursor adiantado pede resync', async () => {
    await deliveries.create(makeDelivery())

    const result = await pull.execute({
      courierId: courierId.toString(),
      sinceVersion: 999,
      limit: 10,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    expect(result.value.resyncRequired).toBe(true)
  })

  it('3. minVersion é exposto e sinceVersion no piso continua válido', async () => {
    await deliveries.create(makeDelivery())

    const result = await pull.execute({
      courierId: courierId.toString(),
      sinceVersion: 0,
      limit: 10,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    // O log ainda não é podado, então minVersion é 0 e o cursor 0 é aceitável.
    // Quando a poda entrar, um cursor abaixo de minVersion passa a pedir resync
    // pelo mesmo caminho do cenário 2.
    expect(result.value.minVersion).toBe(0)
    expect(result.value.resyncRequired).toBe(false)
    expect(result.value.changes).toHaveLength(1)
  })

  it('4. compactação: 20 mudanças da mesma entrega viram um UPSERT', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    for (let index = 0; index < 10; index += 1) {
      delivery.markOutForDelivery()
      await deliveries.save(delivery)
      delivery.registerFailedAttempt('Ausente', new Date())
      await deliveries.save(delivery)
    }

    const result = await pull.execute({
      courierId: courierId.toString(),
      sinceVersion: 0,
      limit: 100,
    })

    if (result.isLeft()) throw new Error('pull falhou')

    expect(result.value.changes).toHaveLength(1)
    expect(result.value.changes[0].type).toBe('UPSERT')
  })

  it('5. janela do snapshot: mudança durante a paginação entra no delta seguinte', async () => {
    await deliveries.create(makeDelivery())
    await deliveries.create(makeDelivery())

    const firstPage = await snapshot.execute({
      courierId: courierId.toString(),
      limit: 1,
      withTotal: true,
    })

    if (firstPage.isLeft()) throw new Error('snapshot falhou')

    const baseVersion = firstPage.value.currentVersion

    // Chega uma entrega nova enquanto o app ainda pagina o snapshot.
    const late = makeDelivery()
    await deliveries.create(late)

    const client = await syncClient(baseVersion, 100)

    expect(client.cache.has(late.id.toString())).toBe(true)
  })

  it('6. escopo por ator: entrega de outro courier nunca aparece', async () => {
    await deliveries.create(makeDelivery(new UniqueEntityID()))

    const client = await syncClient(0, 100)

    expect(client.cache.size).toBe(0)
  })

  it('7. reatribuição: courier antigo recebe REMOVE, novo recebe UPSERT', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    const before = await syncClient(0, 100)
    expect(before.cache.has(delivery.id.toString())).toBe(true)

    delivery.assignTo(new UniqueEntityID())
    await deliveries.save(delivery)

    const after = await syncClient(before.cursor, 100)
    expect(after.cache.has(delivery.id.toString())).toBe(false)
  })

  it('8. push idempotente: mesmo clientEventId duas vezes, um efeito só', async () => {
    const delivery = makeDelivery()
    await deliveries.create(delivery)

    const event = {
      clientEventId: 'evt-1',
      deliveryId: delivery.id.toString(),
      type: 'OUT_FOR_DELIVERY' as const,
      occurredAt: new Date(),
    }

    await push.execute({ courierId: courierId.toString(), events: [event] })
    const second = await push.execute({
      courierId: courierId.toString(),
      events: [event],
    })

    if (second.isLeft()) throw new Error('push falhou')

    expect(second.value.results[0].status).toBe('DUPLICATE')
    expect(deliveries.items[0].revision).toBe(1)
  })

  it('9. push parcial: item rejeitado não impede os demais', async () => {
    const cancelled = makeDelivery()
    const healthy = makeDelivery()
    await deliveries.create(cancelled)
    await deliveries.create(healthy)

    cancelled.cancel('operação cancelou')
    await deliveries.save(cancelled)

    const result = await push.execute({
      courierId: courierId.toString(),
      events: [
        {
          clientEventId: 'evt-1',
          deliveryId: cancelled.id.toString(),
          type: 'OUT_FOR_DELIVERY',
          occurredAt: new Date(),
        },
        {
          clientEventId: 'evt-2',
          deliveryId: healthy.id.toString(),
          type: 'OUT_FOR_DELIVERY',
          occurredAt: new Date(),
        },
      ],
    })

    if (result.isLeft()) throw new Error('push falhou')

    expect(result.value.results[0].status).toBe('REJECTED')
    expect(result.value.results[1].status).toBe('APPLIED')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.mts test/sync-protocol/delta-sync.spec.ts`
Expected: FAIL — `No test files found`, porque o `include` do config ainda não cobre `test/sync-protocol`

- [ ] **Step 3: Write minimal implementation**

Em `vitest.config.mts`, trocar a linha `include`:

```ts
    include: [
      'src/**/*.spec.ts',
      'test/architecture/**/*.spec.ts',
      'test/sync-protocol/**/*.spec.ts',
    ],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — os 9 cenários passam junto com o resto da suíte

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test
git add test/sync-protocol vitest.config.mts
git commit -m "test(delivery): cover delta sync protocol scenarios"
```

---

### Task 20: E2E do ciclo completo

**Files:**

- Create: `test/e2e/delivery-lifecycle.e2e-spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import type { App } from 'supertest/types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '@/app.module'
import { SEEDED_PRODUCT_IDS } from '@/infrastructure/database/in-memory/products.seed'

describe('Ciclo de entrega (e2e)', () => {
  let app: INestApplication
  let httpServer: App

  const courierId = randomUUID()

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleRef.createNestApplication()
    await app.init()

    httpServer = app.getHttpServer() as App
  })

  afterAll(async () => {
    await app.close()
  })

  it('percorre snapshot, delta, push do campo e avaliação', async () => {
    const created = await request(httpServer)
      .post('/deliveries')
      .send({
        courierId,
        customer: {
          name: 'Maria',
          phone: '11999999999',
          address: 'Rua A, 100',
        },
        items: [{ productId: SEEDED_PRODUCT_IDS.coffee, quantity: 2 }],
      })
      .expect(201)

    const deliveryId = (created.body as { delivery: { id: string } }).delivery
      .id

    const snapshot = await request(httpServer)
      .get(`/couriers/${courierId}/deliveries/snapshot`)
      .query({ withTotal: true })
      .expect(200)

    const snapshotBody = snapshot.body as {
      currentVersion: number
      totalItems: number
      deliveries: { id: string; totalCents: number }[]
    }

    expect(snapshotBody.totalItems).toBe(1)
    expect(snapshotBody.deliveries[0].totalCents).toBe(7980)

    const pushed = await request(httpServer)
      .post(`/couriers/${courierId}/deliveries/events`)
      .send({
        events: [
          {
            clientEventId: randomUUID(),
            deliveryId,
            type: 'OUT_FOR_DELIVERY',
            occurredAt: new Date('2026-09-21T12:00:00.000Z').toISOString(),
          },
          {
            clientEventId: randomUUID(),
            deliveryId,
            type: 'DELIVERED',
            occurredAt: new Date('2026-09-21T12:30:00.000Z').toISOString(),
            receivedBy: 'Porteiro',
          },
        ],
      })
      .expect(200)

    const pushBody = pushed.body as { results: { status: string }[] }
    expect(pushBody.results.map((item) => item.status)).toEqual([
      'APPLIED',
      'APPLIED',
    ])

    await request(httpServer)
      .post(`/deliveries/${deliveryId}/rating`)
      .send({ score: 5, comment: 'Chegou antes do previsto' })
      .expect(201)

    const delta = await request(httpServer)
      .get(`/couriers/${courierId}/deliveries/changes`)
      .query({ sinceVersion: snapshotBody.currentVersion, limit: 100 })
      .expect(200)

    const deltaBody = delta.body as {
      hasMore: boolean
      resyncRequired: boolean
      changes: {
        type: string
        delivery?: { status: string; rating: { score: number } | null }
      }[]
    }

    expect(deltaBody.hasMore).toBe(false)
    expect(deltaBody.resyncRequired).toBe(false)
    expect(deltaBody.changes).toHaveLength(1)
    expect(deltaBody.changes[0].type).toBe('UPSERT')
    expect(deltaBody.changes[0].delivery?.status).toBe('DELIVERED')
    expect(deltaBody.changes[0].delivery?.rating?.score).toBe(5)
  })

  it('rejeita avaliação fora da faixa com 422', async () => {
    const created = await request(httpServer)
      .post('/deliveries')
      .send({
        courierId,
        customer: {
          name: 'João',
          phone: '11988888888',
          address: 'Rua B, 200',
        },
        items: [{ productId: SEEDED_PRODUCT_IDS.mug, quantity: 1 }],
      })
      .expect(201)

    const deliveryId = (created.body as { delivery: { id: string } }).delivery
      .id

    await request(httpServer)
      .post(`/deliveries/${deliveryId}/rating`)
      .send({ score: 9 })
      .expect(422)
  })

  it('rejeita avaliação de entrega não entregue com 409', async () => {
    const created = await request(httpServer)
      .post('/deliveries')
      .send({
        courierId,
        customer: {
          name: 'Ana',
          phone: '11977777777',
          address: 'Rua C, 300',
        },
        items: [{ productId: SEEDED_PRODUCT_IDS.filter, quantity: 1 }],
      })
      .expect(201)

    const deliveryId = (created.body as { delivery: { id: string } }).delivery
      .id

    const response = await request(httpServer)
      .post(`/deliveries/${deliveryId}/rating`)
      .send({ score: 5 })
      .expect(409)

    expect((response.body as { code: string }).code).toBe(
      'DELIVERY_NOT_DELIVERED',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:e2e`
Expected: FAIL antes do Task 18 estar concluído; com o Task 18 pronto, roda e deve passar já nesta primeira execução

- [ ] **Step 3: Write minimal implementation**

Nenhum código novo: este task exercita o que os anteriores construíram. Se algum caso falhar, corrigir no arquivo indicado pela mensagem de erro — não no teste.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:e2e`
Expected: PASS — 5 tests (2 do `app.e2e-spec.ts` + 3 deste arquivo)

- [ ] **Step 5: Commit**

```bash
npm run lint && npm test && npm run test:e2e
git add test/e2e
git commit -m "test(delivery): add end-to-end delivery lifecycle"
```

---

### Task 21: Documentação do projeto

**Files:**

- Create: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write the README**

````markdown
# nestjs-offline-sync

API offline-first de entrega de produtos e qualificação de entrega, construída para
demonstrar um protocolo de sincronização correto: snapshot + delta sync no download e
escrita offline idempotente no upload.

## Protocolo

| Rota                                                 | Uso                                          |
| ---------------------------------------------------- | -------------------------------------------- |
| `GET /couriers/:courierId/deliveries/snapshot`       | Primeira carga, paginada por cursor          |
| `GET /couriers/:courierId/deliveries/changes`        | Delta incremental a partir de `sinceVersion` |
| `POST /couriers/:courierId/deliveries/events`        | Lote de eventos do campo, resultado por item |
| `POST /deliveries/:deliveryId/rating`                | Avaliação 0–5 com comentário                 |
| `POST /deliveries` e `PATCH /deliveries/:deliveryId` | Operação: cria, altera, reatribui, cancela   |

O cliente avança o cursor para `nextVersion` (a maior versão do lote), **nunca** para
`currentVersion`, e repete a chamada enquanto `hasMore` for verdadeiro. `resyncRequired`
indica cursor velho demais ou adiantado: nos dois casos o app refaz o snapshot.

## Rodando

```bash
npm ci
npm run start:dev     # http://localhost:3333, Swagger em /docs
npm test              # unit + arquitetura + protocolo de sync
npm run test:e2e      # ciclo completo via HTTP
```
````

Persistência é in-memory: reiniciar o processo zera os dados. Produtos são pré-cadastrados
por seed.

## Documentação

- [Spec de design](docs/superpowers/specs/2026-09-21-api-entregas-delta-sync-design.md)
- [Plano de implementação](docs/superpowers/plans/2026-09-21-api-entregas-delta-sync.md)

````

- [ ] **Step 2: Update AGENTS.md**

Substituir o parágrafo que diz que `src/domain/` está vazio por:

```markdown
`src/domain/delivery/` é o único bounded context: entregas atribuídas a entregadores,
sincronizadas por snapshot + delta sync, e avaliadas pelo destinatário depois da entrega.
O protocolo de sincronização está especificado em
[docs/superpowers/specs/2026-09-21-api-entregas-delta-sync-design.md](docs/superpowers/specs/2026-09-21-api-entregas-delta-sync-design.md)
— leia antes de mexer em qualquer coisa que toque `version`, `nextVersion` ou o log de mudanças.
````

- [ ] **Step 3: Verify the full suite**

Run: `npm run lint:check && npm run format:check && npm test && npm run test:e2e && npm run build`
Expected: tudo limpo

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: document delivery sync api"
```
