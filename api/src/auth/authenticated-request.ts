import type { Request } from 'express';
import type { AccountSummaryDto } from './account-summary.dto.js';

export interface AuthenticatedPrincipal extends AccountSummaryDto {
  sessionId: string;
}
export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedPrincipal;
}
