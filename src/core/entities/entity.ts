import { UniqueEntityID } from '@/core/entities/unique-entity-id'

export abstract class Entity<Props> {
  private _id: UniqueEntityID
  protected props: Props

  get id(): UniqueEntityID {
    return this._id
  }

  protected constructor(props: Props, id?: UniqueEntityID) {
    this.props = props
    this._id = id ?? new UniqueEntityID()
  }

  public equals(entity: Entity<unknown>): boolean {
    return entity === this || entity.id.equals(this._id)
  }
}
