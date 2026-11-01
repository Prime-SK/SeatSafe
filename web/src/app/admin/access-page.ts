import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { AdminAccess } from './admin-access';
@Component({
  selector: 'app-admin-access',
  imports: [RouterLink, ButtonModule, MessageModule],
  template: `<section class="state-panel">
    <h1>Administrator access</h1>
    <p-message severity="warn">{{ access.message() }}</p-message>
    @if (access.retryable()) {
      <p-button label="Retry access check" (onClick)="access.retry()" />
    }
    <a pButton severity="secondary" routerLink="/workshops">Browse workshops</a>
  </section>`,
})
export class AccessPage {
  protected readonly access = inject(AdminAccess);
}
