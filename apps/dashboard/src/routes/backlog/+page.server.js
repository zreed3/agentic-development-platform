import { featureDetail, releaseGateViolations } from '$lib/server/data.js';

export function load() {
  return {
    features: featureDetail(),
    violations: releaseGateViolations()
  };
}
