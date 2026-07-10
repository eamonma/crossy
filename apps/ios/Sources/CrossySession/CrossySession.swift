// CrossySession (AD-2: adapter; imports CrossyStore, CrossyProtocol). The
// URLSessionWebSocketTask transport implementing the store's transport port; it only
// sleeps, jitters, and dials (AD-6) — reconnect logic lives in CrossyStore where the
// vectors pin it. Fills in Phase I1c.
