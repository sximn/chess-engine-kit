import { validateRequest } from "../../core/validation.js";
import { EngineError, type AnalyzeRequest } from "../../core/types.js";
import { FROZENIGHT_CAPABILITIES } from "./capabilities.js";
export function validateFrozenightRequest(request: AnalyzeRequest) {
  validateRequest(request, FROZENIGHT_CAPABILITIES);
  if (request.limits.maxNodes === undefined)
    throw new EngineError(
      "INVALID_OPTIONS",
      "Frozenight requires an explicit maxNodes limit.",
    );
}
