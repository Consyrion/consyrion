/**
 * Private CONSYRION engine (#188). Copied into packages/engine/src of the application by scripts/select-engine.mjs
 * (local development) and by deploy/hetzner/deploy.sh (production). Never push this to GitHub.
 * Logic moves here step by step: first the #181 requirement gate, then verdict, checks, prompts and strength catalog.
 */
import { ENGINE_CONTRACT_VERSION, type Engine } from "../contract";
import { evaluateGate } from "./gate";
import { REQUIREMENT_CHECK_INSTRUCTION } from "./prompts";

export const engine: Engine = {
  info: { kind: "production", name: "CONSYRION engine", contract: ENGINE_CONTRACT_VERSION },
  evaluateGate,
  requirementCheckInstruction: REQUIREMENT_CHECK_INSTRUCTION,
};
