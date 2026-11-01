import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, QueryFailedError, TypeORMError } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { UserEntity } from '../users/user.entity.js';
import { AuthSessionEntity } from '../auth/auth-session.entity.js';
import { WorkshopEntity } from '../workshops/workshop.entity.js';
import { toWorkshopResponse } from '../workshops/workshop-response.js';
import type { MyBookingPageDto } from './my-bookings.dto.js';
import { RegistrationError } from '../auth/registration-error.js';
import { unauthorized } from '../auth/session-authentication.service.js';
import type { AuthenticatedPrincipal } from '../auth/authenticated-request.js';
import { BookingEntity } from './booking.entity.js';
import { BookingIdempotencyEntity } from './booking-idempotency.entity.js';
import type { BookingOutcome } from './booking-idempotency.entity.js';
import { bookingFingerprint } from './idempotency-key.js';
import type {
  BookingResponseDto,
  BookingPageDto,
  BookingPageQuery,
} from './booking.dto.js';

export const bookingError = (status: number, code: string, message: string) =>
  new RegistrationError(status, code, message);
const missing = () =>
  bookingError(404, 'WORKSHOP_NOT_FOUND', 'Workshop not found');
const duplicate = () =>
  bookingError(
    409,
    'ALREADY_BOOKED',
    'You already have an active booking for this workshop',
  );
type BookingResponse = {
  id: string;
  workshopId: string;
  status: BookingEntity['status'];
  createdAt: string;
  cancelledAt: string | null;
};
export function bookingResponse(row: BookingEntity): BookingResponse {
  return {
    id: row.id,
    workshopId: row.workshopId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
}
@Injectable()
export class BookingsService {
  constructor(@InjectDataSource() private readonly database: DataSource) {}
  async reserve(
    principal: AuthenticatedPrincipal,
    workshopId: string,
    requestKey: string,
  ): Promise<BookingResponseDto> {
    let databaseBoundary = true;
    try {
      const fingerprint = bookingFingerprint(workshopId);
      const outcome = await this.database.transaction(
        async (manager): Promise<BookingOutcome> => {
          databaseBoundary = false;
          // User first, workshop second. Session mutations use the same user lock.
          const user = await manager
            .getRepository(UserEntity)
            .createQueryBuilder('user')
            .setLock('pessimistic_write')
            .where('user.id = :id', { id: principal.id })
            .getOne();
          if (!user?.isEnabled) throw unauthorized();
          await this.session(manager, principal);
          const records = manager.getRepository(BookingIdempotencyEntity);
          const saved = await records.findOneBy({
            userId: user.id,
            requestKey,
          });
          if (saved) {
            if (saved.fingerprint !== fingerprint) {
              throw bookingError(
                409,
                'IDEMPOTENCY_KEY_CONFLICT',
                'Request key was already used for another request',
              );
            }
            databaseBoundary = true;
            return { status: saved.httpStatus, body: saved.response };
          }
          // Save safe business outcomes as values, so their transaction can commit.
          const complete = async (
            value: BookingResponseDto | RegistrationError,
          ): Promise<BookingOutcome> => {
            const result: BookingOutcome =
              value instanceof RegistrationError
                ? {
                    status: value.getStatus() as 404 | 409,
                    body: value.getResponse() as BookingOutcome['body'],
                  }
                : { status: 201, body: value };
            await records.insert({
              id: randomUUID(),
              userId: user.id,
              requestKey,
              fingerprint,
              httpStatus: result.status,
              response: result.body,
            });
            databaseBoundary = true;
            return result;
          };
          const workshops = manager.getRepository(WorkshopEntity);
          const workshop = await workshops
            .createQueryBuilder('workshop')
            .setLock('pessimistic_write')
            .where('workshop.id = :id', { id: workshopId })
            .getOne();
          // Expiry may have passed while waiting for the workshop lock.
          await this.session(manager, principal);
          if (!workshop) return complete(missing());
          const bookings = manager.getRepository(BookingEntity);
          if (
            await bookings.existsBy({
              userId: user.id,
              workshopId,
              status: 'ACTIVE',
            })
          )
            return complete(duplicate());
          if (!workshop.registrationOpen)
            return complete(
              bookingError(
                409,
                'REGISTRATION_CLOSED',
                'Registration is closed',
              ),
            );
          if (workshop.startsAt.getTime() <= Date.now())
            return complete(
              bookingError(
                409,
                'WORKSHOP_ALREADY_STARTED',
                'Workshop has already started',
              ),
            );
          if (workshop.reservedSeats >= workshop.capacity)
            return complete(
              bookingError(409, 'WORKSHOP_FULL', 'Workshop is full'),
            );
          const booking = bookings.create({
            id: randomUUID(),
            userId: user.id,
            workshopId,
            status: 'ACTIVE',
            cancelledAt: null,
          });
          await bookings.insert(booking);
          await workshops.increment({ id: workshopId }, 'reservedSeats', 1);
          const response = bookingResponse(booking);
          return complete(response);
        },
      );
      if (outcome.status !== 201) {
        const body = outcome.body as { code: string; message: string };
        throw bookingError(outcome.status, body.code, body.message);
      }
      return outcome.body as BookingResponseDto;
    } catch (error) {
      throw this.safeError(error, 'Unable to reserve seat', databaseBoundary);
    }
  }
  async list(
    workshopId: string,
    query: BookingPageQuery,
  ): Promise<BookingPageDto> {
    let databaseBoundary = true;
    try {
      if (
        !(await this.database
          .getRepository(WorkshopEntity)
          .existsBy({ id: workshopId }))
      )
        throw missing();
      const [rows, total] = await this.database
        .getRepository(BookingEntity)
        .createQueryBuilder('booking')
        .innerJoinAndSelect('booking.user', 'user')
        .where('booking.workshopId = :workshopId', { workshopId })
        .orderBy('booking.createdAt', 'ASC')
        .addOrderBy('booking.id', 'ASC')
        .skip((query.page - 1) * query.limit)
        .take(query.limit)
        .getManyAndCount();
      databaseBoundary = false;
      return {
        items: rows.map((row) => ({
          ...bookingResponse(row),
          user: {
            id: row.user.id,
            displayName: row.user.displayName,
            email: row.user.email,
          },
        })),
        total,
        page: query.page,
        limit: query.limit,
      };
    } catch (error) {
      throw this.safeError(error, 'Unable to load bookings', databaseBoundary);
    }
  }
  async mine(
    principal: AuthenticatedPrincipal,
    query: BookingPageQuery,
  ): Promise<MyBookingPageDto> {
    let databaseBoundary = true;
    try {
      const [rows, total] = await this.database
        .getRepository(BookingEntity)
        .createQueryBuilder('booking')
        .innerJoinAndSelect('booking.workshop', 'workshop')
        .where('booking.userId = :userId', { userId: principal.id })
        .orderBy('booking.createdAt', 'DESC')
        .addOrderBy('booking.id', 'DESC')
        .skip((query.page - 1) * query.limit)
        .take(query.limit)
        .getManyAndCount();
      databaseBoundary = false;
      return {
        items: rows.map((row) => ({
          ...bookingResponse(row),
          workshop: toWorkshopResponse(row.workshop),
        })),
        total,
        page: query.page,
        limit: query.limit,
      };
    } catch (error) {
      throw this.safeError(error, 'Unable to load bookings', databaseBoundary);
    }
  }
  async cancel(
    principal: AuthenticatedPrincipal,
    bookingId: string,
  ): Promise<BookingResponseDto> {
    let databaseBoundary = true;
    const notFound = () =>
      bookingError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    const invalidState = () =>
      bookingError(500, 'INTERNAL_ERROR', 'Unable to cancel booking');
    try {
      return await this.database.transaction(async (manager) => {
        databaseBoundary = false;
        const user = await manager
          .getRepository(UserEntity)
          .createQueryBuilder('user')
          .setLock('pessimistic_write')
          .where('user.id = :id', { id: principal.id })
          .getOne();
        if (!user?.isEnabled) throw unauthorized();
        await this.session(manager, principal);
        const bookings = manager.getRepository(BookingEntity);
        const located = await bookings.findOneBy({
          id: bookingId,
          userId: user.id,
        });
        if (!located) throw notFound();
        const workshops = manager.getRepository(WorkshopEntity);
        const workshop = await workshops
          .createQueryBuilder('workshop')
          .setLock('pessimistic_write')
          .where('workshop.id = :id', { id: located.workshopId })
          .getOne();
        const booking = await bookings
          .createQueryBuilder('booking')
          .setLock('pessimistic_write')
          .where('booking.id = :id AND booking.userId = :userId', {
            id: bookingId,
            userId: user.id,
          })
          .getOne();
        await this.session(manager, principal);
        if (!booking) throw notFound();
        if (!workshop || booking.workshopId !== workshop.id)
          throw invalidState();
        if (booking.status === 'ACTIVE') {
          if (workshop.reservedSeats <= 0) throw invalidState();
          booking.status = 'CANCELLED';
          booking.cancelledAt = new Date();
          await bookings.update(
            { id: booking.id, userId: user.id },
            { status: booking.status, cancelledAt: booking.cancelledAt },
          );
          await workshops.decrement({ id: workshop.id }, 'reservedSeats', 1);
        }
        const response = bookingResponse(booking);
        databaseBoundary = true;
        return response;
      });
    } catch (error) {
      throw this.safeError(error, 'Unable to cancel booking', databaseBoundary);
    }
  }
  private async session(
    manager: EntityManager,
    principal: AuthenticatedPrincipal,
  ): Promise<void> {
    const session = await manager
      .getRepository(AuthSessionEntity)
      .findOneBy({ id: principal.sessionId, userId: principal.id });
    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now()
    )
      throw unauthorized();
  }
  private safeError(
    error: unknown,
    message: string,
    databaseBoundary = false,
  ): RegistrationError {
    if (error instanceof RegistrationError) return error;
    const driver =
      error instanceof QueryFailedError
        ? (error.driverError as { code?: string; constraint?: string })
        : undefined;
    if (
      driver?.code === '23505' &&
      driver.constraint === 'UQ_bookings_active_user_workshop'
    )
      return duplicate();
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
    if (
      databaseBoundary ||
      error instanceof TypeORMError ||
      /^(?:[0-9A-Z]{5}|ECONN\w+|ETIMEDOUT|EPIPE)$/.test(code)
    )
      return bookingError(503, 'DATABASE_UNAVAILABLE', 'Database unavailable');
    return bookingError(500, 'INTERNAL_ERROR', message);
  }
}
