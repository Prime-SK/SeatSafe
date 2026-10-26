import { Injectable } from '@angular/core';
import { Observable, Subject, defer } from 'rxjs';
import { SessionCoordinator, SessionNotice } from './session-coordinator';
@Injectable()
export class TestSessionCoordinator {
  supported = true;
  readonly incoming = new Subject<SessionNotice>();
  readonly notices = this.incoming.asObservable();
  readonly sent: SessionNotice[] = [];
  announce(notice: SessionNotice): void {
    this.sent.push(notice);
  }
  run<T>(operation: () => Observable<T>): Observable<T> {
    return defer(operation);
  }
}
export const sessionTestingProvider = {
  provide: SessionCoordinator,
  useClass: TestSessionCoordinator,
};
