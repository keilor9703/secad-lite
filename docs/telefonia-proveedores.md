# Plantas telefónicas en FALCON: cómo se agrega un proveedor

FALCON no está atado a un proveedor de telefonía. Esta página explica qué es
una «planta» para FALCON, qué pone cada proveedor y qué hay que escribir para
dar de alta uno nuevo —Infobip, el que venga— sin tocar la base de datos, la
pantalla, la cola de llamadas ni los casos.

> **Por qué existe este documento.** La primera integración se escribió para
> Zadarma y se le notaba: la tabla de configuración tenía columnas
> `zadarmaKey` y `zadarmaSecreto`, y la pantalla de Plataforma pedía «Key de la
> API de Zadarma» con ese texto escrito a mano. Funcionaba, y el segundo
> proveedor costaba dos columnas, una migración, un trozo de pantalla y una
> rama más en el servicio de configuración. Al tercero, nadie recuerda qué
> campo usa cuál.

---

## 1. Lo que es igual para todos, y lo que cambia

Todos los proveedores se parecen: entregan llamadas entrantes por webhook,
muchos saben originar una llamada por API, algunos dejan contestar por WebRTC,
algunos graban. **Lo que cambia es el detalle** —cómo se firma, cómo se llaman
los campos, qué sabe hacer cada uno—, no la forma.

| Lo pone FALCON (una sola vez, para todos) | Lo pone el proveedor (en su archivo) |
|---|---|
| Resolver de qué instancia es el aviso (API key de la ruta) | Cómo verifica que el aviso es auténtico |
| Comprobar que la instancia contrató telefonía y con qué planta | Qué significa cada uno de sus eventos |
| Comprobar que la planta está encendida | Qué credenciales necesita, y cuáles son secretas |
| La cola en vivo, el aviso al operador, el caso, los informes | Qué sabe hacer: entrantes, marcar, softphone, grabación |
| La bitácora de cada petición (`pbx_webhook_log`) | Dónde se pega la dirección del webhook, en SU panel |
| Cifrar lo secreto, no devolverlo nunca al navegador | |
| Dibujar el formulario de configuración | |

---

## 2. Las capacidades

Un proveedor **declara** lo que FALCON puede hacer con él, y la pantalla no
ofrece lo demás: así el operador no descubre con un error que su planta no
puede llamar desde el caso.

| Capacidad | Qué habilita |
|---|---|
| `entrantes` | Las llamadas entran a la cola de Recepción. Es el mínimo para existir. |
| `marcar` | El botón «Llamar» del caso: la central llama al operador y después al ciudadano. |
| `softphone` | Contestar **dentro** de FALCON (SIP sobre WebSocket / WebRTC), sin softphone aparte. |
| `grabacion` | Traer la grabación de la llamada al caso. |

> **Declaran lo que FALCON sabe hacer, no lo que el proveedor sabría hacer.**
> Zadarma graba, pero mientras FALCON no traiga la grabación al caso,
> `grabacion` **no** va en su lista: ponerla haría que la pantalla ofreciera
> algo que no existe.

Hoy:

| Proveedor | Capacidades | Credenciales que pide |
|---|---|---|
| **YACO** | `entrantes` | Ninguna: entrega por el webhook genérico, autenticado con la API key de la instancia |
| **Zadarma** | `entrantes` | Key y Secret de su API |

> **Sobre YACO, para no confundirse.** Las llamadas que hoy llegan de YACO
> entran por esta integración, «Planta telefónica (PBX)». La integración **CTI
> / YACO (barra embebida)** —[`integracion-cti-yaco.md`](integracion-cti-yaco.md)—
> es otra cosa, y en FALCON está solo como **esqueleto**: el proveedor todavía
> no ha desarrollado la barra.

---

## 3. Dar de alta un proveedor: tres pasos

### 3.1 Su archivo

`backend/src/pbx/proveedores/<nombre>.proveedor.ts`, implementando
`ProveedorPbx`:

```ts
export class ProveedorEjemplo implements ProveedorPbx {
  readonly descriptor: DescriptorProveedor = {
    clave: 'EJEMPLO',                    // lo que se guarda en config_pbx
    nombre: 'Ejemplo',
    resumen: 'Una línea: qué es y de quién es la factura.',
    capacidades: ['entrantes'],          // solo lo que YA funciona
    credenciales: [
      { clave: 'token', etiqueta: 'Token de la API', ayuda: 'Dónde se consigue, en SU panel.',
        secreto: true, requerido: true, forma: '^[A-Za-z0-9]{32}$' },
    ],
    rutaAviso: '/api/pbx/ejemplo/',
    dondeSePega: 'Ajustes → Webhooks → Eventos de llamada',
  };

  verificar(cuerpo, firma, cred) { /* ¿viene de verdad de ellos? */ }
  traducir(cuerpo) { /* qué significa este evento, en el modelo de FALCON */ }
}
```

Dos cosas que el descriptor decide sin que haya que escribirlas en ningún otro
sitio:

- **`secreto: true`** hace que el valor se cifre en reposo, que **nunca** vuelva
  al navegador (ni truncado) y que un formulario que no lo recibió tampoco lo
  borre al guardar. Esas tres reglas estaban escritas a mano para los dos
  campos de Zadarma; ahora un proveedor nuevo no puede olvidarlas.
- **`requerido: true`** hace que la planta no se pueda **encender** sin ese
  campo —pero sí **elegir**, que es distinto y costó una sesión entender:
  el campo donde se escribe la credencial solo aparece después de elegir el
  proveedor, así que exigirla antes deja la pantalla en un callejón sin salida.

### 3.2 Registrarlo

En `proveedores/registro.ts`, agregarlo a la lista. **El primero de la lista es
el que se asume** cuando una instancia no tiene fila de configuración: cambiar
ese orden cambiaría, en silencio, el comportamiento de todas las instancias sin
configurar.

### 3.3 Su controlador

```ts
@Controller('pbx/ejemplo')
export class EjemploController {
  constructor(private readonly avisos: AvisosPbxService) {}

  @Public() @Post(':clave')
  webhook(@Req() req, @Param('clave') clave, @Body() cuerpo, @Headers('x-firma') firma?: string) {
    return this.avisos.recibir({ proveedor: 'EJEMPLO', clave, cuerpo, firma, req });
  }
}
```

**Y eso es todo.** No hay que tocar `config_pbx`, ni la pantalla de Plataforma
—se arma del catálogo que publica `GET /api/plataforma/pbx/proveedores`—, ni la
cola, ni los casos, ni los informes.

---

## 4. Por qué la dirección del webhook NO está unificada

Sería tentador una sola ruta `/api/pbx/avisos/:proveedor/:clave`. No se hizo, y
a propósito:

1. **Cada panel admite UNA dirección y la valida a su manera.** Zadarma manda
   un `zd_echo` al guardar y exige que se le devuelva *tal cual*: sin comillas,
   sin JSON, sin salto de línea. Otro exigirá otra cosa. Ese saludo no se puede
   generalizar sin volverlo un árbol de condiciones.
2. **Una dirección pegada en un panel de producción no se puede mover.** Si
   cambia, se cae la línea del 123 de un municipio hasta que alguien entre a
   ese panel a corregirla.

Lo que sí pasa por el puerto es la **verificación** y la **traducción**, que es
donde está el trabajo de verdad. El transporte y el saludo son de cada uno.

---

## 5. Dónde vive

| Pieza | Archivo |
|---|---|
| El puerto: capacidades, credenciales, descriptor | `backend/src/pbx/proveedores/proveedor.ts` |
| El aviso en forma neutra | `backend/src/pbx/proveedores/aviso.ts` |
| El registro (agregar un proveedor aquí) | `backend/src/pbx/proveedores/registro.ts` |
| Zadarma | `backend/src/pbx/proveedores/zadarma.proveedor.ts` |
| YACO | `backend/src/pbx/proveedores/yaco.proveedor.ts` |
| El camino común de un aviso | `backend/src/pbx/avisos.service.ts` |
| Credenciales: leer, descifrar, guardar | `backend/src/pbx/pbx-credenciales.service.ts` |
| Configuración por instancia | `backend/src/pbx/pbx-config.service.ts`, `config-pbx.entity.ts` |
| Cola, casos y avisos (comunes a todas las plantas) | `backend/src/pbx/pbx.service.ts` |
| La pantalla, armada del catálogo | `frontend/src/app/pages/plataforma/` |

Para el detalle de Zadarma —su firma, su `zd_echo`, su panel, su mapa de
eventos y qué falta— ver [`telefonia-zadarma.md`](telefonia-zadarma.md).
