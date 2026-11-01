import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { defer, finalize, shareReplay } from 'rxjs';
import { REQUIRES_AUTH } from '../auth/auth-interceptor';
import { Workshop } from '../workshops/workshop';
import { WorkshopInput } from './workshop-draft';

@Injectable({ providedIn: 'root' })
export class AdminWorkshopsApi {
  private readonly http = inject(HttpClient);
  readonly notice = signal('');
  readonly saving = signal(false);
  save(id: string | null, input: Partial<WorkshopInput>) {
    return defer(() => {
      this.saving.set(true);
      const options = { context: new HttpContext().set(REQUIRES_AUTH, true) };
      return id
        ? this.http.patch<Workshop>(
            `/api/admin/workshops/${encodeURIComponent(id)}`,
            input,
            options,
          )
        : this.http.post<Workshop>('/api/admin/workshops', input, options);
    }).pipe(
      finalize(() => this.saving.set(false)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
  }
}
