import { Component, inject, afterEveryRender } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { Authentication } from './auth/authentication';
import { DOCUMENT } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TagModule } from 'primeng/tag';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TagModule],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly router = inject(Router);
  protected readonly auth = inject(Authentication);
  private readonly document = inject(DOCUMENT);
  constructor() {
    let focusPending = false;
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd) focusPending = true;
    });
    afterEveryRender(() => {
      if (!focusPending) return;
      focusPending = false;
      const target =
        this.document.querySelector<HTMLElement>('main h1') ??
        this.document.querySelector<HTMLElement>('main');
      target?.setAttribute('tabindex', '-1');
      target?.focus({ preventScroll: true });
    });
  }
}
