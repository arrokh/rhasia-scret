# Unit test ownership

Domain-specific unit and component tests mirror their owning bounded context in a named subdirectory. Cross-context architecture inventories remain in `architecture/`; application-shell and shared-mechanic tests remain in `app-shell/` and `shared/`.

Contract, integration, and browser suites stay in their top-level test categories because they verify transport seams, database adapters, or end-to-end behavior across contexts. Do not add flat files directly under `unit/`.
