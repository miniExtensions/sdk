# Synthetic customer-chat fixture

From the SDK checkout, run `pnpm build`, then
`node examples/customer-chat/dev.mjs`. Open the printed loopback URL on the same
device. The fixture uses the public SDK imports and real React composition;
the provider boundary is synthetic and CSP denies network connections.

Mount both roots to preserve the same conversation. Hide the root-one overlay,
switch root two's app, remove the active root and verify restoration. Capture a
help action, change ownership and try the retained action. Insertion callbacks
must not make the provider available; availability alone must not imply visibility.
Remove both roots, then fire callbacks again to verify final cleanup.

Stop the task-owned server with Ctrl-C when finished. This is a developer fixture,
not provider activation, message delivery or hosted/native acceptance.
