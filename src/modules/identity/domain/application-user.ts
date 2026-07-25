export type ApplicationUserStatus = "ACTIVE" | "INACTIVE";

export class ApplicationUser {
  public constructor(
    public readonly id: string,
    public readonly subject: string,
    public readonly email: string,
    public readonly status: ApplicationUserStatus
  ) {
    if (!id || !subject || !email) throw new Error("Application user identity is required.");
  }

  public canAccessApplication(): boolean {
    return this.status === "ACTIVE";
  }
}
