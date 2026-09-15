export class AccountDeletionChallengeUnavailableError extends Error {
  public constructor(message = "Account deletion challenge is unavailable.") {
    super(message);
    this.name = "AccountDeletionChallengeUnavailableError";
  }
}

export class AccountDeletionOtpInvalidError extends Error {
  public constructor(message = "Account deletion OTP is invalid.") {
    super(message);
    this.name = "AccountDeletionOtpInvalidError";
  }
}

export class AccountDeletionOtpLockedError extends Error {
  public constructor(message = "Account deletion OTP attempts are exhausted.") {
    super(message);
    this.name = "AccountDeletionOtpLockedError";
  }
}

export class AccountDeletionPlanStaleError extends Error {
  public constructor(message = "Account deletion choices are stale.") {
    super(message);
    this.name = "AccountDeletionPlanStaleError";
  }
}

export class AccountDeletionAuthorizationError extends Error {
  public constructor(message = "Account deletion authorization is invalid.") {
    super(message);
    this.name = "AccountDeletionAuthorizationError";
  }
}
