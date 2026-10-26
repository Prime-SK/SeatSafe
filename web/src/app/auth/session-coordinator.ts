import { DestroyRef, Injectable, inject } from '@angular/core';
import { Observable, Subject, defer, firstValueFrom, from, throwError } from 'rxjs';

export type SessionNotice =
  'session-changed' | 'logout-started' | 'logout-completed' | 'session-unavailable';
const notices: readonly string[] = [
  'session-changed',
  'logout-started',
  'logout-completed',
  'session-unavailable',
];

/** Only credential-free lifecycle notices cross tabs. Web Locks serialize cookie mutations. */
@Injectable({ providedIn: 'root' })
export class SessionCoordinator {
  readonly supported =
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    typeof navigator.locks?.request === 'function' &&
    typeof BroadcastChannel === 'function';
  private readonly channel = this.supported ? new BroadcastChannel('seatsafe-session-v1') : null;
  private readonly incoming = new Subject<SessionNotice>();
  readonly notices = this.incoming.asObservable();
  constructor() {
    if (this.channel)
      this.channel.onmessage = (event) => {
        if (typeof event.data === 'string' && notices.includes(event.data))
          this.incoming.next(event.data as SessionNotice);
      };
    inject(DestroyRef).onDestroy(() => {
      this.channel?.close();
      this.incoming.complete();
    });
  }
  announce(notice: SessionNotice): void {
    this.channel?.postMessage(notice);
  }
  run<T>(operation: () => Observable<T>): Observable<T> {
    if (!this.supported) return throwError(() => new Error('Session coordination is unavailable'));
    return defer(() =>
      from(navigator.locks.request('seatsafe-auth-cookie-v1', () => firstValueFrom(operation()))),
    );
  }
}
