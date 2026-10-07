const TRIP_REASON_LABELS: Record<string, string> = {
  OVERVOLTAGE: "Overvoltage",
  UNDERVOLTAGE: "Undervoltage",
  OVERCURRENT: "Overcurrent",
  BLACKOUT: "Blackout",
  MANUAL: "Manual trip",
  LOCAL_OVERVOLTAGE: "Local safety: overvoltage",
  LOCAL_UNDERVOLTAGE: "Local safety: undervoltage",
  LOCAL_OVERCURRENT: "Local safety: overcurrent",
};

const PHASE_LABELS: Record<string, string> = {
  A: " (Phase A)",
  B: " (Phase B)",
  C: " (Phase C)",
};

/**
 * Human-readable trip reason. Handles the phase-suffixed variants written by
 * both trip paths (e.g. OVERVOLTAGE_PHASE_A, LOCAL_OVERVOLTAGE_PHASE_B) and
 * falls back to de-underscored text for anything unmapped.
 */
export function formatTripReason(reason: string | null): string {
  if (!reason) return "Unknown";

  const phaseMatch = /_PHASE_([ABC])$/.exec(reason);
  const base = phaseMatch ? reason.slice(0, -8) : reason;
  const suffix = phaseMatch ? (PHASE_LABELS[phaseMatch[1]] ?? "") : "";
  const label = TRIP_REASON_LABELS[base] ?? base.replace(/_/g, " ");
  return `${label}${suffix}`;
}
