import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Workshop } from './workshop';

@Injectable({ providedIn: 'root' })
export class WorkshopsApi {
  private readonly http = inject(HttpClient);
  getWorkshops(): Observable<Workshop[]> {
    return this.http.get<Workshop[]>('/api/workshops');
  }
  getWorkshop(id: string): Observable<Workshop> {
    return this.http.get<Workshop>(`/api/workshops/${encodeURIComponent(id)}`);
  }
}
