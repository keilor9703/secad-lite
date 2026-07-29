import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login').then((m) => m.LoginComponent) },
  {
    path: '',
    loadComponent: () => import('./layout/shell/shell').then((m) => m.ShellComponent),
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'recepcion' },
      { path: 'recepcion', loadComponent: () => import('./pages/recepcion/recepcion').then((m) => m.RecepcionComponent) },
      { path: 'recepcion/:id', loadComponent: () => import('./pages/detalle/detalle').then((m) => m.DetalleComponent) },
      { path: 'chat', loadComponent: () => import('./pages/chat/chat').then((m) => m.ChatComponent) },
      { path: 'dashboard', loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.DashboardComponent) },
      { path: 'recursos', loadComponent: () => import('./pages/recursos/recursos').then((m) => m.RecursosComponent) },
      { path: 'admin', loadComponent: () => import('./pages/admin/admin').then((m) => m.AdminComponent) },
    ],
  },
  { path: '**', redirectTo: '' },
];
