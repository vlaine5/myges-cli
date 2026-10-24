import type { NextFunction, Request, Response } from 'express';
import { AppError } from './app-error';

export type AsyncHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => Promise<unknown>;

export function asyncHandler(handler: AsyncHandler) {
  return (request: Request, response: Response, next: NextFunction) => {
    void Promise.resolve(handler(request, response, next)).catch(next);
  };
}

export function parseBoolean(value: unknown, fallback = false) {
  if (typeof value !== 'string') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function parseDateValue(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AppError(`${fieldName} is required and must be an ISO date string.`, 400, 'INVALID_DATE');
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(`${fieldName} is not a valid date.`, 400, 'INVALID_DATE');
  }

  return parsed;
}
