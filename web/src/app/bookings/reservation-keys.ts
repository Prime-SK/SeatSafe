import { Injectable, InjectionToken, inject } from '@angular/core';

export const RESERVATION_ENVIRONMENT = new InjectionToken<{
  storage: () => Storage;
  uuid: () => string;
}>('reservation environment', {
  providedIn: 'root',
  factory: () => ({ storage: () => window.sessionStorage, uuid: () => crypto.randomUUID() }),
});
export class ReservationKeyError extends Error {
  constructor(readonly resettable: boolean) {
    super(resettable ? 'Saved reservation needs review' : 'Reservation storage is unavailable');
  }
}
const prefix = 'seatsafe.reservation.v1:';
const validKey = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
@Injectable({ providedIn: 'root' })
export class ReservationKeys {
  private readonly environment = inject(RESERVATION_ENVIRONMENT);
  private slot(accountId: string, workshopId: string): string {
    return `${prefix}${encodeURIComponent(accountId)}:${encodeURIComponent(workshopId)}`;
  }
  private storage(): Storage {
    try {
      return this.environment.storage();
    } catch {
      throw new ReservationKeyError(false);
    }
  }
  peek(accountId: string, workshopId: string): string | null {
    let raw: string | null;
    try {
      raw = this.storage().getItem(this.slot(accountId, workshopId));
    } catch {
      throw new ReservationKeyError(false);
    }
    if (raw === null) return null;
    try {
      const row: unknown = JSON.parse(raw);
      if (
        !row ||
        typeof row !== 'object' ||
        Object.keys(row).sort().join(',') !== 'accountId,key,version,workshopId'
      )
        throw new Error();
      const value = row as Record<string, unknown>;
      if (
        value['version'] !== 1 ||
        value['accountId'] !== accountId ||
        value['workshopId'] !== workshopId ||
        !validKey(value['key'])
      )
        throw new Error();
      return value['key'];
    } catch {
      throw new ReservationKeyError(true);
    }
  }
  obtain(accountId: string, workshopId: string): string {
    const existing = this.peek(accountId, workshopId);
    if (existing) return existing;
    try {
      const key = this.environment.uuid();
      if (!validKey(key)) throw new Error();
      this.storage().setItem(
        this.slot(accountId, workshopId),
        JSON.stringify({ version: 1, accountId, workshopId, key }),
      );
      if (this.peek(accountId, workshopId) !== key) throw new Error();
      return key;
    } catch (error) {
      if (error instanceof ReservationKeyError) throw error;
      throw new ReservationKeyError(false);
    }
  }
  remove(accountId: string, workshopId: string, key?: string): boolean {
    try {
      if (key && this.peek(accountId, workshopId) !== key) return true;
      this.storage().removeItem(this.slot(accountId, workshopId));
      return this.storage().getItem(this.slot(accountId, workshopId)) === null;
    } catch {
      return false;
    }
  }
  clear(): void {
    try {
      const storage = this.storage();
      const slots = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
        (key): key is string => !!key?.startsWith(prefix),
      );
      for (const key of slots) storage.removeItem(key);
    } catch {
      /* Storage failures block future reservations rather than breaking logout. */
    }
  }
  retainAccount(accountId: string): void {
    try {
      const storage = this.storage();
      const own = `${prefix}${encodeURIComponent(accountId)}:`;
      const slots = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
        (key): key is string => !!key?.startsWith(prefix) && !key.startsWith(own),
      );
      for (const key of slots) storage.removeItem(key);
    } catch {
      /* Read/dispatch reports storage failures safely. */
    }
  }
}
