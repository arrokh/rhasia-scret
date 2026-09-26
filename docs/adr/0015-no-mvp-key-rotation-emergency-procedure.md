# No MVP key-rotation emergency procedure

> **Status:** Accepted for the MVP compromise response; normal browser rotation is implemented but not yet released. Native rotation UX remains out of scope here and is tracked by [#228](https://github.com/arrokh/rhasia-scret/issues/228).

This decision concerns a suspected compromise, not routine cryptographic maintenance. A successful key rotation changes the current encrypted Vault state and member envelopes, but cannot erase keys, ciphertext, or TOTP secrets already copied by an authorized member or device. Authorization revocation likewise prevents future access but cannot recall material already obtained.

Until the browser rotation workflows are released and available to users, a suspected compromise requires the owner to create a new Vault, reset and re-add affected TOTP credentials at their original services, re-grant members, and delete the old Vault. After release, Vault and User Encryption Key Pair rotation may help protect future access to the replacement encrypted state; it does not replace resetting any TOTP credential believed exposed. Rotation remains a deliberate, manually initiated browser ceremony; there is no background or emergency auto-rotation.
