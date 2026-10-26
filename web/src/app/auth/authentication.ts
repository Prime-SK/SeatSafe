import { Injectable, DestroyRef, NgZone, computed, inject, signal } from '@angular/core';
import { defer, map, tap } from 'rxjs';
import { LoginApi } from './login-api';
import type { AccountSummary, LoginInput } from './login-api';

@Injectable({ providedIn: 'root' })
export class Authentication {
  private readonly api = inject(LoginApi);
  private readonly zone = inject(NgZone);
  #session = signal<{ accessToken: string; account: AccountSummary; expiresAt: number } | null>(
    null,
  );
  readonly account = computed(() => this.#session()?.account ?? null);
  readonly authenticated = computed(() => this.account() !== null);
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  constructor() {
    inject(DestroyRef).onDestroy(() => this.clear());
  }

  login(input: LoginInput) {
    return defer(() => {
      const startedAt = Date.now();
      return this.api.login(input).pipe(
        tap((result) => {
          const expiresAt = startedAt + result.expiresIn * 1000;
          if (
            !result.accessToken ||
            result.tokenType !== 'Bearer' ||
            !Number.isFinite(expiresAt) ||
            expiresAt <= Date.now() ||
            !result.user
          )
            throw new Error('Unable to establish authentication');
          this.clear();
          const { id, displayName, email, role } = result.user;
          this.#session.set({
            accessToken: result.accessToken,
            account: { id, displayName, email, role },
            expiresAt,
          });
          this.zone.runOutsideAngular(() => {
            this.expiryTimer = setTimeout(
              () => this.zone.run(() => this.clear()),
              expiresAt - Date.now(),
            );
          });
        }),
        map(() => undefined),
      );
    });
  }
  private clear(): void {
    if (this.expiryTimer !== undefined) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    this.#session.set(null);
  }
}
