# Local verification for remembered-browser unlock

A Remembered Browser requires Local Verification through WebAuthn user verification before unlocking a vault. This avoids repeatedly requesting the Vault Unlock Secret while preventing an existing authenticated session alone from exposing OTPs on an unattended browser; browsers without this capability require the Vault Unlock Secret.
