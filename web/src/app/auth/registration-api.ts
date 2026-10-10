import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface RegistrationInput {
  displayName: string;
  email: string;
  password: string;
}
export interface RegisteredUser {
  id: string;
  displayName: string;
  email: string;
  role: 'USER';
}
@Injectable({ providedIn: 'root' })
export class RegistrationApi {
  private readonly http = inject(HttpClient);
  register(input: RegistrationInput): Observable<RegisteredUser> {
    return this.http.post<RegisteredUser>('/api/auth/register', input);
  }
}
