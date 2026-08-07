import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { inicioGuard } from './core/inicio.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login').then((m) => m.LoginComponent) },
  {
    path: '',
    loadComponent: () => import('./layout/shell/shell').then((m) => m.ShellComponent),
    canActivate: [authGuard],
    children: [
      // A dónde entra cada quien depende de su trabajo (ver inicioGuard).
      { path: '', pathMatch: 'full', canActivate: [inicioGuard], children: [] },
      { path: 'recepcion', loadComponent: () => import('./pages/recepcion/recepcion').then((m) => m.RecepcionComponent) },
      { path: 'despacho', loadComponent: () => import('./pages/despacho/despacho').then((m) => m.DespachoComponent) },
      { path: 'casos', loadComponent: () => import('./pages/casos/casos').then((m) => m.CasosComponent) },
      { path: 'caso/:id', loadComponent: () => import('./pages/detalle/detalle').then((m) => m.DetalleComponent) },
      // Ruta anterior del detalle: se conserva para no romper enlaces guardados.
      { path: 'recepcion/:id', redirectTo: 'caso/:id' },
      { path: 'llamadas', loadComponent: () => import('./pages/llamadas/llamadas').then((m) => m.LlamadasComponent) },
      { path: 'chat', loadComponent: () => import('./pages/chat/chat').then((m) => m.ChatComponent) },
      { path: 'dashboard', loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.DashboardComponent) },
      { path: 'recursos', loadComponent: () => import('./pages/recursos/recursos').then((m) => m.RecursosComponent) },
      { path: 'catalogos', loadComponent: () => import('./pages/catalogos/catalogos').then((m) => m.CatalogosComponent) },
      { path: 'admin', loadComponent: () => import('./pages/admin/admin').then((m) => m.AdminComponent) },
      { path: 'plataforma', loadComponent: () => import('./pages/plataforma/plataforma').then((m) => m.PlataformaComponent) },
    ],
  },
  { path: '**', redirectTo: '' },
];
