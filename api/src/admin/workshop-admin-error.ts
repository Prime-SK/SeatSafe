import { HttpException } from '@nestjs/common';

export class WorkshopAdminError extends HttpException {
  constructor(
    statusCode: number,
    code: string,
    message: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(
      { statusCode, code, message, ...(fieldErrors ? { fieldErrors } : {}) },
      statusCode,
    );
  }
}
export function invalidWorkshop(
  field: string,
  message: string,
): WorkshopAdminError {
  return new WorkshopAdminError(
    400,
    'VALIDATION_FAILED',
    'Invalid workshop data',
    { [field]: [message] },
  );
}
