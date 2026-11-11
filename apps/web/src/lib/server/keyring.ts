import "server-only";
import { keyringFromEnv, type Keyring } from "@consyrium/core";

let cached: Keyring | undefined;

/** Throws a CONFIGURATION error when no master key is set, so keys are never stored unencrypted. */
export function getKeyring(): Keyring {
  cached ??= keyringFromEnv(process.env);
  return cached;
}
