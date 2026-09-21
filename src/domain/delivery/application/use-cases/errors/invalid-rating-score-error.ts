import { UseCaseError } from '@/core/errors/use-case-error'

export class InvalidRatingScoreError extends Error implements UseCaseError {
  constructor(raw: number) {
    super(`Invalid rating score: ${raw}. Expected an integer between 0 and 5`)
  }
}
