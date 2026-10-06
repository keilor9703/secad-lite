# Respaldo y video — la estrategia, en una página

> Escrito para leerse de corrido, sin saber de PostgreSQL. Si algo de aquí no
> se entiende, está mal escrito: dígalo y se arregla.

## La regla

**Ningún dato se borra nunca.** Lo único que cambia con el tiempo es DÓNDE
están los bytes, nunca si existen.

Hay que distinguir dos cosas que suenan igual y no lo son:

- **Rotar copias** sí se hace. Guardar quince fotos diarias y soltar la
  decimosexta no pierde nada: la información sigue viva en la base, la copia
  solo servía para poder volver atrás.
- **Borrar datos** no se hace nunca. Ni por antigüedad, ni por espacio.

---

## Dónde vive una grabación, según su edad

| Edad | Dónde están los bytes | Qué ve el operador |
|---|---|---|
| 0 – 90 días | En la base de datos | La abre con un clic |
| 90 días en adelante | En el bucket (nube) | La abre con un clic, igual |
| Cuando el bucket se llena | Baja a la NAS y **se borra del bucket** | «Solicítela al administrador», con el nombre exacto |

Tres cosas que importan de esa tabla:

1. **Pasar de la base al bucket no se nota.** Falcon la sirve desde allá y el
   operador no distingue una de otra. Los 90 días son para que la base no
   crezca sin control, no para esconder nada.
2. **Del bucket solo se borra DESPUÉS** de bajar el archivo a la NAS y
   comprobar byte a byte que la copia coincide. Si no coincide, no se borra.
3. **La NAS es el archivo definitivo y solo crece.** De ahí no se borra jamás.

El paso de bucket a NAS se dispara por espacio, no por calendario: cuando el
bucket llegue al 75 % de lo contratado.

## Qué ve el operador cuando ya no está en línea

El caso sigue listando la grabación. En vez del botón de reproducir aparece:

> **Esta grabación está en el archivo permanente.**
> Solicítela al administrador con este nombre:
> `2026/10/<id>.webm`
> Verificación: `a1b2c3…`

Ese nombre es la ruta real dentro de la NAS: **el archivo permanente espeja la
estructura del bucket**, así que el administrador busca por lo que ve en
pantalla, sin traducir nada. El `sha256` sirve para comprobar, al entregarla,
que es byte a byte la que se grabó — eso es lo que la hace defendible en un
proceso.

---

## El respaldo de la base de datos

Son dos respaldos distintos, y conviene saber por qué.

**Diario — todo menos el video.** Casos, usuarios, catálogos, configuración,
enrolamientos del doble factor. Unos pocos MB: se puede hacer todos los días,
guardar quince copias y bajarlo por una conexión normal. **Esto es lo
irreemplazable.** Un caso perdido no se reconstruye.

**Completo — incluye las grabaciones que todavía están en la base.** Pesa, así
que se hace de vez en cuando y se trata con más cuidado: una copia completa
**no se rota** mientras no conste que salió del servidor, o porque se subió
(`.subido`) o porque alguien la bajó y confirmó su `sha256` (`.afuera`). Si no
consta, el script avisa y no borra nada.

```bash
~/falcon-deploy/secad-lite/deploy/respaldo-falcon.sh            # diario
~/falcon-deploy/secad-lite/deploy/respaldo-falcon.sh completo
~/falcon-deploy/secad-lite/deploy/respaldo-falcon.sh espacio    # cuánto crece
```

### Lo que de verdad importa: `verificar`

```bash
~/falcon-deploy/secad-lite/deploy/respaldo-falcon.sh verificar
```

**Un volcado que nadie restauró no es un respaldo, es un archivo.** `verificar`
restaura de verdad el último respaldo en una base desechable y exige que el
número de filas coincida con el que tenía la base viva.

Esto no es paranoia de más. Casi todas las tablas llevan `FORCE ROW LEVEL
SECURITY`: si el rol de la base dejara de poder saltárselo, el volcado se vería
perfectamente normal **con las tablas vacías por dentro**. Se descubriría el día
que hubiera que restaurar. Por eso cada respaldo deja al lado un `.conteos`.

### El respaldo tiene que salir del servidor

Un respaldo que solo vive en la máquina que respalda no es un respaldo: si se
pierde la máquina, se pierden los dos. Con `FALCON_RESPALDO_URL` apuntando a una
URL prefirmada del bucket, el script lo sube solo.

---

## Calendario

| Cuándo | Qué | Quién |
|---|---|---|
| Todos los días, 02:15 | Respaldo diario + subida fuera del servidor | `cron` |
| Todos los domingos | `verificar` — restauración real de prueba | `cron` |
| Cada mes | Respaldo `completo` y bajarlo a disco externo | Administrador |
| Cuando el bucket llegue al 75 % | Bajar todo a la NAS, verificar, y solo entonces borrar del bucket | Administrador |

---

## Qué comprar: requisitos de la NAS

El archivo permanente **solo crece**. Para dimensionarlo hay que medir primero
—`respaldo-falcon.sh espacio` dice cuánto crece al mes— pero los requisitos no
dependen del tamaño:

- **Dos discos en espejo (RAID 1) como mínimo.** Un disco solo no es un archivo
  permanente, es un disco esperando a fallar.
- **Acceso desde el servidor de Falcon** por red, con un usuario de solo
  escritura para el proceso de bajada.
- **Capacidad para 3 años de crecimiento medido, por dos.** Ampliar una NAS
  llena con el sistema en producción es caro y se hace mal.
- **Que acepte discos de repuesto en caliente**, o al menos que cambiar uno no
  exija apagarla.
- **Un segundo juego de discos fuera del edificio.** Una NAS en la misma sala
  que el servidor no protege contra incendio ni contra robo. Esto es lo que más
  se olvida y lo único que protege del desastre de verdad.

---

## Lo que todavía NO está puesto

- [ ] El bucket y su URL prefirmada → `ARCHIVO_OBJETOS_URL`. **Sin esto el
      archivado no hace nada**: las grabaciones se quedan en la base para
      siempre y el disco crece.
- [ ] `FALCON_RESPALDO_URL`, para que el respaldo salga del servidor.
- [ ] Las tareas de `cron`.
- [ ] La primera restauración de prueba (`verificar`) — **hágala con los datos
      de prueba de ahora**, que es cuando romper no cuesta nada.
- [ ] El script que baja del bucket a la NAS y marca las grabaciones como
      `EN_CUSTODIA`. Se escribe cuando exista la NAS; el estado ya está en el
      sistema para que nada se rompa ese día.
