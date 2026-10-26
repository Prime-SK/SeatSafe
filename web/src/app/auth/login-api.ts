import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface LoginInput {
  email: string;
  password: string;
}
export interface AccountSummary {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: 'USER' | 'ADMIN';
}
export interface LoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: AccountSummary;
}
@Injectable({ providedIn: 'root' })
export class LoginApi {
  private readonly http = inject(HttpClient);
  refresh(): Observable<LoginResult> {
    return this.http.post<LoginResult>('/api/auth/refresh', {});
  }
  logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', {});
  }
  login(input: LoginInput): Observable<LoginResult> {
    return this.http.post<LoginResult>('/api/auth/login', input);
  }
}
