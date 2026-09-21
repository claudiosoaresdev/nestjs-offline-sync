import { isDeepStrictEqual } from 'node:util'

export abstract class ValueObject<Props> {
  protected readonly props: Props

  protected constructor(props: Props) {
    this.props = props
  }

  public equals(vo: ValueObject<unknown>): boolean {
    if (vo === this) return true
    if (vo === null || vo === undefined) return false

    return isDeepStrictEqual(vo.props, this.props)
  }
}
