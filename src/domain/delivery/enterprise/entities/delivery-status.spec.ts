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

  it('recusa transição para o próprio status', () => {
    expect(
      DeliveryStatus.pending().canTransitionTo(DeliveryStatus.pending()),
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
