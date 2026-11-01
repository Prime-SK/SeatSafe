import { Routes } from '@angular/router';
import { adminGuard } from './admin-access';
import { installAdminTheme } from './admin-theme';
installAdminTheme();
export const adminRoutes: Routes = [
  {
    path: 'access',
    loadComponent: () => import('./access-page').then((m) => m.AccessPage),
    title: 'Administrator access | SeatSafe',
  },
  {
    path: 'workshops',
    canActivate: [adminGuard],
    loadComponent: () => import('./management-list').then((m) => m.ManagementList),
    title: 'Manage workshops | SeatSafe',
  },
  {
    path: 'workshops/new',
    canActivate: [adminGuard],
    canDeactivate: [
      (component: import('./workshop-editor').WorkshopEditor) => component.canLeave(),
    ],
    loadComponent: () => import('./workshop-editor').then((m) => m.WorkshopEditor),
    title: 'Create workshop | SeatSafe',
  },
  {
    path: 'workshops/:id/edit',
    canActivate: [adminGuard],
    canDeactivate: [
      (component: import('./workshop-editor').WorkshopEditor) => component.canLeave(),
    ],
    loadComponent: () => import('./workshop-editor').then((m) => m.WorkshopEditor),
    title: 'Edit workshop | SeatSafe',
  },
];
