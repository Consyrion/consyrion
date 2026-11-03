import { DomainError } from "@consyrion/core";
import { engine } from "@consyrion/engine";
import { ENGINE_NOT_INSTALLED, engineProblem, type EngineInfo } from "@consyrion/engine/contract";

/** The engine this installation runs with (#188). */
export function engineInfo(): EngineInfo {
  return engine.info;
}

/** Refuses council work without a usable engine: a fresh clone of the public repository cannot run councils. */
export function assertEngineInstalled(): void {
  // Production sets this (deploy/hetzner/compose.yml): only the engine counts, never the test engine.
  const problem =
    process.env.CONSYRION_REQUIRE_PRODUCTION_ENGINE === "1" && engine.info.kind !== "production"
      ? `This installation requires the production CONSYRION engine, but runs the ${engine.info.kind} engine.`
      : engineProblem(engine);
  if (problem) throw new DomainError("CONFIGURATION", problem, { code: ENGINE_NOT_INSTALLED });
}
