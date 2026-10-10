import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'register',
    loadComponent: () => import('./auth/register').then((m) => m.Register),
    title: 'Create account | SeatSafe',
  },
  { path: '', pathMatch: 'full', redirectTo: 'workshops' },
  {
    path: 'workshops',
    loadComponent: () => import('./workshops/workshop-list').then((m) => m.WorkshopList),
    title: 'Workshops | SeatSafe',
  },
  {
    path: 'workshops/:id',
    loadComponent: () => import('./workshops/workshop-detail').then((m) => m.WorkshopDetail),
    title: 'Workshop details | SeatSafe',
  },
  {
    path: '**',
    loadComponent: () => import('./page-not-found/page-not-found').then((m) => m.PageNotFound),
    title: 'Page not found | SeatSafe',
  },
];
