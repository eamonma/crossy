// CrossyStore (AD-2: application; imports CrossyEngine, CrossyProtocol). GameStore,
// optimistic overlay, snapshot reconciliation, and the connection state machine (AD-1,
// AD-3, AD-6); ports are defined here as protocols (ARCHITECTURE.md §4). Filled in
// Phase I1b: the shared client-store vectors (vectors/v1/client-store) are the
// specification, executed against GameStore by Tests/CrossyStoreTests, the drift fence
// between this store and apps/web's (PROTOCOL.md §13). The web twin is
// apps/web/src/store/gameStore.ts; behavior the vectors pin must not diverge from it.
