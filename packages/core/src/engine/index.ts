/** Server-only engine entry (#188/#189): never import from client components. */
export { decomposeRequirement } from "./requirement-decomposition";
export { extractRequirements, stripContextSections, segmentRequirementText, looksLikeInjection, classifySuspicion, candidateKey, withoutQuotes } from "./requirement-extraction";
