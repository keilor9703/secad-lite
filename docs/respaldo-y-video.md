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
pierde la máquina, se pierden los dos. Con `FALCON_RESPALDO_URL` el script lo
sube solo, nada más terminarlo.

## Dos buckets, no uno

Son dos destinos distintos y van en **dos cubos separados**, cada uno con su
propio enlace prefirmado:

| Variable | Qué guarda | Permiso del enlace |
|---|---|---|
| `ARCHIVO_OBJETOS_URL` | Las grabaciones archivadas | **Lectura y escritura** |
| `FALCON_RESPALDO_URL` | Los volcados de la base | **Solo escritura** |

No es manía de ordenar. Las tres razones:

**1. El permiso no puede ser el mismo.** Falcon *sirve* las grabaciones desde
su cubo, así que necesita leerlas: el enlace es de lectura y escritura. Los
respaldos solo se suben. Con un enlace de **solo escritura**, alguien que
entrara al servidor podría subir basura pero **no podría leerse ni borrarse los
respaldos** — y un volcado de la base lo contiene todo: cada caso, cada
usuario, los enrolamientos del doble factor. Es el archivo más sensible del
sistema. Recuperarlo se hace a mano desde la consola de Oracle, que es
exactamente donde uno quiere ese trámite.

**2. Los ciclos de vida son opuestos.** Las grabaciones se quedan hasta que
bajan a la NAS. Los respaldos se acumulan. Mezclarlos invita a que una regla
pensada para unos toque a los otros.

**3. Si un enlace se filtra, no se filtra el otro.**

Active además **versionado** en el cubo de respaldos: así, si algo sobrescribe
un respaldo con basura, la versión buena sigue ahí.

> **Lo que esto NO cubre, y conviene saberlo.** El servidor de Falcon y los dos
> cubos están en la misma cuenta de Oracle. Si se pierde la cuenta —impago,
> cierre, acceso comprometido— se pierden los tres a la vez. De eso solo
> protege una copia fuera de esa cuenta: el respaldo `completo` mensual bajado
> a un disco externo (el script lo registra con `confirmar`) y, cuando exista,
> la NAS. Es el paso que más se salta todo el mundo y el único que protege del
> desastre de verdad.

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

## Archivar ahora, sin esperar al barrido

El barrido corre solo a las **3:19**. Para no esperar —al configurar el
almacén por primera vez, o antes de una ventana de mantenimiento— hay un botón:

**Administración → Integraciones → Archivado de grabaciones → «Archivar ahora»**
(solo superadmin).

Dice una de dos cosas:

- **«No hay a dónde archivar»** → falta `ARCHIVO_OBJETOS_URL`. No archiva nada
  y el disco crece. Es lo primero que hay que mirar.
- **«Archivadas N grabación(es)»** → funcionó. Si N es cero, no es un error:
  ninguna ha cumplido el plazo todavía.

Por debajo es un `POST` a `/api/archivos/archivado/ejecutar`. **No se puede
llamar escribiendo la URL en el navegador** —la barra de direcciones hace
`GET`, y la respuesta sería «Cannot GET»—; por eso el botón.

Usa el mismo trabajo que el cron, con su mismo bloqueo: si otra réplica está
archivando, esta pasada no hace nada.

### Probar la cadena completa el día que se configura

Con datos de prueba, que es cuando no cuesta nada:

1. Baje el plazo a un día: `ARCHIVO_DIAS=1` en el `.env`, declararla en el
   compose y recrear las réplicas.
2. Dispare el archivado con el `curl` de arriba. Debe responder `archivadas`
   mayor que cero.
3. Abra ese caso en Falcon y **reproduzca la grabación**. Tiene que verse
   igual: ya se está sirviendo desde el bucket.
4. Mire el bucket en la consola de Oracle: ahí están los objetos.
5. Vuelva a dejar `ARCHIVO_DIAS` en 90.

Si el paso 3 funciona, la cadena entera está probada: subir, volver a bajar,
comparar byte a byte, liberar la base y servir desde el bucket.

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
