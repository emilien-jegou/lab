import * as Docker from "./internal/docker";

/**
 * Logical id for the shared stack bridge network.
 *
 * Alchemy keys resources by FQN, so `Docker.Network(STACK_NETWORK_ID, …)` is
 * idempotent: the first `yield*` registers the network and every later site
 * inherits the same resource (see Alchemy's "reference it from elsewhere"
 * registration path). This replaces the previous module-level mutable singleton
 * in `getStackNetwork`, which hid the resource from the stack body and could
 * leak a stale handle across `alchemy dev` re-compositions.
 *
 * All call sites pass identical props, so the "first registration wins"
 * invariant holds.
 */
export const STACK_NETWORK_ID = "homelab-net";

/**
 * The shared stack bridge network every container attaches to.
 */
export const getStackNetwork = () =>
  Docker.Network(STACK_NETWORK_ID, {
    driver: "bridge",
  });
