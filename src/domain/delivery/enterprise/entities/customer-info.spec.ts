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
