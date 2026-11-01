export const scenarios = [
  'seat-contention',
  'matching-key',
  'different-keys',
] as const;
export type LabScenario = (typeof scenarios)[number];
export interface LabAttempt {
  attempt: number;
  userLabel: string;
  outcome: 'success' | 'conflict' | 'timeout' | 'unexpected' | 'undispatched';
  code?: string;
}
export interface LabReport {
  runId: string;
  scenario: LabScenario;
  status: 'running' | 'completed' | 'failed' | 'incomplete';
  stage: 'preparing' | 'executing' | 'cleaning' | 'finished';
  startedAt: string;
  completedAt: string | null;
  postgres: string | null;
  isolation: string | null;
  requested: number;
  workers: number;
  attempts: LabAttempt[];
  successes: number;
  conflicts: Record<string, number>;
  timeouts: number;
  unexpected: number;
  undispatched: number;
  capacity: number;
  activeBookings: number | null;
  reservedSeats: number | null;
  idempotencyRecords: number | null;
  uniqueBookings: number;
  matchingSnapshots: boolean;
  invariantsPassed: boolean;
  cleanup: 'pending' | 'removed' | 'failed';
  message: string;
}
