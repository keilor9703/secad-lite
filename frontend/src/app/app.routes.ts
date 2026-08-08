import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { inicioGuard } from './core/inicio.guard';
import { permisoGuard, superadminGuard } from './core/permiso.guard';

// Cada módulo exige el mismo permiso que gobierna su pestaña en la barra de
// navegación (ver ShellComponent): ocultar la pestaña sin proteger la ruta
// dejaba entrar por URL a la interfaz del módulo.
export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login').then((m) => m.LoginComponent) },
  {
    path: '',
    loadComponent: () => import('./layout/shell/shell').then((m) => m.ShellComponent),
    canActivate: [authGuard],
    children: [
      // A dónde entra cada quien depende de su trabajo (ver inicioGuard).
      { path: '', pathMatch: 'full', canActivate: [inicioGuard], children: [] },
      { path: 'recepcion', canActivate: [permisoGuard('casos.crear')],
        loadComponent: () => import('./pages/recepcion/recepcion').then((m) => m.RecepcionComponent) },
      { path: 'despacho', canActivate: [permisoGuard('despacho.ver')],
        loadComponent: () => import('./pages/despacho/despacho').then((m) => m.DespachoComponent) },
      { path: 'despacho/:id', canActivate: [permisoGuard('despacho.ver')],
        loadComponent: () => import('./pages/despacho/despacho').then((m) => m.DespachoComponent) },
      { path: 'casos', canActivate: [permisoGuard('casos.ver_todos')],
        loadComponent: () => import('./pages/casos/casos').then((m) => m.CasosComponent) },
      // Detalle del caso como página propia: quien despacha lo abre dentro de
      // su tablero, pero quien solo recepciona o consulta necesita verlo SIN
      // pasar por el módulo de Despacho (antes /caso/:id redirigía allá).
      { path: 'caso/:id', canActivate: [permisoGuard('casos.ver')],
        loadComponent: () => import('./pages/detalle/detalle').then((m) => m.DetalleComponent) },
      // Ruta anterior del detalle: se conserva para no romper enlaces guardados.
      { path: 'recepcion/:id', redirectTo: 'caso/:id' },
      // La cola de llamadas vive dentro de Recepción: aquí solo por enlaces antiguos.
      { path: 'llamadas', redirectTo: 'recepcion' },
      { path: 'chat', loadComponent: () => import('./pages/chat/chat').then((m) => m.ChatComponent) },
      { path: 'dashboard', canActivate: [permisoGuard('metricas.ver')],
        loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.DashboardComponent) },
      { path: 'recursos', canActivate: [permisoGuard('recursos.ver')],
        loadComponent: () => import('./pages/recursos/recursos').then((m) => m.RecursosComponent) },
      { path: 'catalogos', canActivate: [permisoGuard('catalogos.gestionar')],
        loadComponent: () => import('./pages/catalogos/catalogos').then((m) => m.CatalogosComponent) },
      { path: 'admin', canActivate: [permisoGuard('usuarios.gestionar', 'roles.gestionar')],
        loadComponent: () => import('./pages/admin/admin').then((m) => m.AdminComponent) },
      { path: 'plataforma', canActivate: [superadminGuard],
        loadComponent: () => import('./pages/plataforma/plataforma').then((m) => m.PlataformaComponent) },
    ],
  },
  { path: '**', redirectTo: '' },
];
