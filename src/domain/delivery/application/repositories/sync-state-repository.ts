export abstract class SyncStateRepository {
  abstract currentVersion(): Promise<number>
}
