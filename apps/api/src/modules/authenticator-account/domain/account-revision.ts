export class AccountRevision {
  public constructor(public readonly value: number) {
    if (!Number.isInteger(value) || value < 1) throw new Error("Account revision must be positive.");
  }
}
