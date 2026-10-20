# Hoja de ruta del ecosistema de telefonía de FALCON CAD

> **Qué es este documento.** El diagnóstico de qué falta, con cada cosa
> identificada, priorizada y marcable. Es el documento que se revisa para saber
> dónde vamos y qué sigue.
>
> **Cómo se usa.** Cada punto tiene un identificador (`T1`, `T2`, …) para poder
> nombrarlo en una conversación sin ambigüedad («sigamos con T4»). Cuando algo
> se termina, se marca la casilla y se anota la fecha y el commit. Lo que se
> descarta no se borra: se marca como descartado con el motivo, porque la razón
> por la que *no* se hizo algo se olvida antes que el algo.
>
> Diagnóstico del 20/10/2026, hecho sobre el código y no de memoria. La primera
> planta propia lleva un día en producción.

---

## Estado hoy

Lo que está probado de punta a punta, en producción, con llamada real:

| | |
|---|---|
| Llamada entrante → caso | ✔ El dialplan avisa a FALCON antes de timbrar |
| Softphone en el navegador | ✔ Sin instalar nada: contestar, colgar, silencio, tonos DTMF |
| Cola de operadores | ✔ `ringall`, miembros estáticos por extensión |
| Contestar abre el caso | ✔ |
| Llamar desde el caso | ✔ Por ARI |
| Grabación en custodia del caso | ✔ Solo borra el local cuando FALCON confirma |
| Administración multi-municipio | ✔ Plataforma → Nuestras centralitas |
| Audio en los dos sentidos | ✔ Desde el 20/10/2026 |

Documentación: [`planta-telefonica-funcionalidades.md`](planta-telefonica-funcionalidades.md)
y [`planta-telefonica-despliegue.md`](planta-telefonica-despliegue.md).

---

## Cómo está priorizado

Cuatro zonas, y el orden entre zonas no es negociable:

- **A — Bloquea operar un 123 de verdad.** Sin esto, lo que tenemos es una
  demostración muy buena, no un servicio.
- **B — Lo que pide una sala real.** Funciona, pero el operador choca con el
  límite la primera semana.
- **C — Deuda con fecha.** Cosas que van a fallar un día concreto.
- **D — Deuda de FALCON CAD**, no de telefonía. Está aquí para que no se
  presente como hallazgo nuevo.

---

## Zona A — Bloquea operar un 123 de verdad

### `T1` · Numeración colombiana y el 123
- [ ] **Pendiente** · *No es trabajo de código*

Hoy el DID es un `+1 833` de Estados Unidos. Un 123 real exige número
colombiano y trámite regulatorio con un operador local.

**Por qué es el primero:** condiciona si todo lo demás es un producto o una
demostración. Un municipio no compra una línea de emergencia con un número
gringo.

**Siguiente paso:** decisión comercial. Ver
[`telefonia-costos-y-proveedores.md`](telefonia-costos-y-proveedores.md) para el
análisis de operadores en Colombia.

---

### `T2` · Monitoreo y alertas de la planta
- [ ] **En curso** · *Primero de la cola de implementación*

**Hoy no existe nada.** Si la troncal se cae a las 3 de la mañana, nadie se
entera hasta que alguien llama a quejarse. No hay chequeo del contenedor, ni de
la troncal, ni del certificado.

**Por qué va primero de lo que sí es código:** es lo más barato de todo y lo que
más cambia las cosas. Sin esto, cualquier otra mejora se construye sobre algo en
lo que no se puede confiar — y la noche del 19 de octubre demostró que una
planta puede estar «arriba» y no servir para nada.

**Qué incluye:**
- [ ] Chequeo periódico de cada planta activa, desde el backend de FALCON:
      - ¿Asterisk responde? (ARI `GET /ari/asterisk/info`, por el mismo 443)
      - ¿La troncal está disponible y cuántos operadores registrados?
        (ARI `GET /ari/endpoints`)
      - ¿Cuándo vence el certificado del nombre de la planta?
- [ ] Guardar el resultado y **desde cuándo** falla, no solo el último estado
- [ ] Avisar cuando un chequeo pasa de bien a mal, y cuando el certificado entra
      en los últimos días — por la mesa de ayuda, que ya existe
- [ ] Mostrarlo en la pantalla de la planta, con el detalle de qué falla

**Dónde se toca:** `backend/src/pbx/planta/` (servicio de salud nuevo),
`frontend/src/app/pages/plataforma/planta/`, y el módulo de correo que ya está.

---

### `T3` · Desborde de la cola
- [ ] **Pendiente**

Si nadie contesta, el ciudadano oye timbre hasta que la cola se rinde y la
llamada se pierde **en silencio**: no queda constancia de que alguien llamó y no
lo atendimos.

**Por qué importa:** es la diferencia entre «no alcanzamos a contestar» y «nadie
se enteró de que había una llamada». En una línea de emergencia es lo único que
no se puede permitir.

**Qué incluye:**
- [ ] Número de desborde configurable por municipio (celular de turno, otra sala)
- [ ] Tiempo de espera antes de desbordar, configurable
- [ ] Que la llamada desbordada quede registrada como tal, no como perdida
- [ ] Aviso a FALCON de que hubo desborde

**Dónde se toca:** `pbx-numero.entity.ts` o un campo nuevo en la planta, el
generador (`queues.conf` y `extensions.conf`), y la pantalla.

---

### `T4` · Alta disponibilidad
- [ ] **Pendiente** · *El más grande de todos*

Un servidor caído deja sin teléfono a **todos** sus municipios. Para una línea
de emergencia eso no es una deuda, es un riesgo.

El modelo ya soporta varias troncales con `prioridad`, pero no hay planta de
respaldo ni conmutación automática.

**Opciones, de menor a mayor esfuerzo:**
1. **Desborde al celular si la planta no responde** — lo configura el operador
   telefónico de su lado. Barato, y cubre el peor caso.
2. **Segunda troncal con otro operador** — cubre la caída del operador, no la
   del servidor.
3. **Planta en espera en otro servidor**, con el destino conmutable. Cubre todo,
   y es un proyecto.

**Recomendación:** hacer (1) en cuanto haya numeración colombiana (`T1`), y
dejar (3) para cuando haya más de tres municipios en el mismo servidor.

---

## Zona B — Lo que pide una sala real

### `T5` · Transferencia entre operadores y a otra agencia
- [ ] **Pendiente** · *Tercero de la cola de implementación*

Hoy un operador que recibe una llamada que no le corresponde **solo puede
colgar**. No hay transferencia ni ciega ni asistida.

Es lo primero que va a pedir una sala real, y en despacho multi-agencia es
funcionalidad básica, no comodidad.

**Dónde se toca:** el softphone (`frontend/src/app/core/softphone/`), el
dialplan generado, y la ficha del caso.

---

### `T6` · Supervisión: escuchar, susurrar, entrar
- [ ] **Pendiente**

Estándar en sala de despacho: el supervisor escucha una llamada en curso, puede
hablarle solo al operador, o entrar a la conversación. Necesario para control de
calidad y para entrenar gente nueva.

Asterisk lo trae (`ChanSpy`); falta el dialplan, el permiso y la pantalla.

---

### `T7` · Retención (hold) con música
- [ ] **Pendiente**

Hoy solo hay silencio de micrófono. No se puede poner a alguien en espera de
verdad.

---

### `T8` · Métricas de cola
- [ ] **Pendiente** · *Los datos ya están, falta el tablero*

Abandono, tiempo de respuesta, nivel de servicio, llamadas por hora. La tabla
`llamada` ya guarda `atendidaPor`, `atendidaEn`, `estado` y `creadoEn`, así que
los datos existen; lo que falta es leerlos y mostrarlos.

Es, además, lo que un municipio grande pide en el pliego.

---

### `T9` · Calidad de audio medida
- [ ] **Pendiente**

Jitter, pérdida de paquetes, MOS. Sin esto, una queja de «se oye mal» no se
puede ni confirmar ni descartar, y se convierte en una discusión.

Asterisk publica estadísticas RTCP; falta recogerlas y guardarlas con la
llamada.

---

### `T10` · Diagnóstico desde la pantalla y aplicar por SSH
- [ ] **Pendiente**

Hoy comprobar una planta es entrar por SSH, que es justo lo que costó la noche
del 19. `T2` cubre buena parte de esto; falta el resto: ver el estado real de la
troncal y de los registros desde la pantalla, y que *Aplicar* se ejecute solo en
el servidor en vez de descargar un script y correrlo a mano.

---

## Zona C — Deuda con fecha

### `T11` · La renovación del certificado está rota
- [ ] **Pendiente** · **Vence el 14 de enero de 2027**

`certbot renew` falla en el servidor de la planta: su configuración guardada usa
el autenticador `nginx` y el 80/443 los tiene Docker. **Ese día el softphone
deja de conectar y nadie va a saber por qué.**

Media hora de trabajo. El procedimiento está en
[`planta-telefonica-despliegue.md`](planta-telefonica-despliegue.md), §4.1.

**Hacerlo esta semana, no en enero.**

---

### `T12` · Credenciales expuestas pendientes de rotar
- [ ] **Pendiente**

- Zadarma: clave y secreto de API, y la clave SIP.
- Las claves SIP de las extensiones que se vieron en pruebas: se rotan vaciando
  el campo en Administración → Funcionarios y volviendo a aplicar.
- La API key del tenant se rota sola en el próximo *Aplicar*.

---

### `T13` · Limpieza del servidor de la planta
- [ ] **Pendiente** · *Pequeño*

- [ ] Devolverle el 3478 a coturn y confirmar que hay candidato `relay`
- [ ] Borrar las reglas repetidas de OCI (hay tres para el 5060)
- [ ] Sacar del servidor al repositorio los dos `location` de nginx del
      softphone: hoy viven escritos a mano y se pierden si la máquina se rehace

---

## Zona D — Deuda de FALCON CAD

No es telefonía, pero está aquí para que no se presente como hallazgo nuevo.

### `T14` · Sin Row-Level Security
- [ ] **Pendiente**

El aislamiento entre municipios es solo de aplicación: cada consulta filtra por
`tenant`. RLS agregaría una segunda capa a nivel de motor, independiente de un
error en el backend.

### `T15` · La bitácora crece sin purga ni archivado
- [ ] **Pendiente**

`casos_eventos` y `admin_bitacora` son de solo escritura y no tienen política de
retención.

### `T16` · `DB_SSL=true` cifra pero no valida la cadena
- [ ] **Pendiente**

Falta `DB_SSL_CA`.

### `T17` · La llamada saliente no es una llamada de FALCON
- [ ] **Pendiente**

Por eso su grabación no se sube ni se enlaza al caso. Es el eslabón que falta
para que entrante y saliente se traten igual.

### `T18` · Puertos reservados por servidor
- [ ] **Pendiente** · *Pequeño*

El asignador solo conoce las plantas, no los otros servicios del host. Las
bandas se eligieron lejos de lo que sabemos que hay, pero el servidor no lo
declara en ninguna parte.

---

## La ruta recomendada

### Ahora
1. **`T2` Monitoreo** — sin esto no se puede confiar en nada de lo demás.
2. **`T3` Desborde de la cola** — barato, y es lo único que no se puede permitir.
3. **`T5` Transferencia** — lo primero que pide una sala real.

### Esta semana, en paralelo y sin código
- **`T11`** el certificado (media hora, y tiene fecha).
- **`T13`** la limpieza del servidor.
- **`T1`** la decisión de numeración colombiana.

### Después
`T8` métricas de cola y `T6` supervisión: es lo que convierte esto en algo
vendible a un municipio grande.

### Cuando haya numeración y más de tres municipios
`T4` alta disponibilidad, en el orden de opciones que dice su ficha.

---

## Registro de avance

| Fecha | Qué | Commit |
|---|---|---|
| 20/10/2026 | Diagnóstico inicial y esta hoja de ruta | — |
