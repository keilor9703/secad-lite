# Carga masiva de catálogos e histórico

Dos utilidades para poblar un secad desde los archivos que entrega la entidad.
Ambas leen CSV (lo que exporta cualquier sistema: Excel, una consulta SQL, el
SECAD completo), aceptan `;` `,` o tabulador como separador, entienden comillas
y la marca BOM de Excel, y son **repetibles**: volver a correrlas no duplica.

Antes de escribir nada conviene siempre una pasada con `--dry-run`, que valida
el archivo completo e informa qué haría.

## 1. Códigos de caso

El listado oficial de tipificación (cientos o miles de filas).

> **Antes de la primera corrida hay que compilar.** Las utilidades viven en
> `dist/`, que no está versionado:
>
> ```bash
> cd backend
> npm install
> npm run build
> ```

La conexión sale de `DATABASE_URL`. Si el `backend/.env` ya la tiene (lo normal
cuando la aplicación corre en esa máquina), no hay que hacer nada más; si no:

```bash
# Linux / macOS
export DATABASE_URL="postgres://usuario:clave@servidor:5432/secad_lite"
```

```powershell
# Windows PowerShell
$env:DATABASE_URL = "postgres://usuario:clave@servidor:5432/secad_lite"
```

```bash
# 1) Revisar sin escribir
npm run importar:codigos -- codigos.csv --tenant envigado --agencia POLICIA --dry-run

# 2) Cargar
npm run importar:codigos -- codigos.csv --tenant envigado --agencia POLICIA
```

En PowerShell, el `--` que separa los argumentos funciona igual; si diera
problemas, se puede llamar directo: `node dist/scripts/importar-codigos.js codigos.csv --tenant envigado --dry-run`.

**Columnas** (el encabezado se reconoce sin importar mayúsculas, tildes ni
signos; entre paréntesis, otros nombres aceptados):

| Campo | Obligatorio | Nombres aceptados |
|---|---|---|
| Código | sí | `codigo`, `cod`, `codigo_caso`, `CODI_PEDIDO`, `TIPO_PEDIDO` |
| Descripción | sí | `descripcion`, `DESCRIPCION_CASO`, `desc_pedido`, `nombre`, `motivo` |
| Prioridad | no | `prioridad`, `IMPORTANCIA`, `nivel` |
| Agencia | no | `agencia`, `entidad`, `fuerza`, `especialidad`, `responsable` |

La **prioridad** admite las palabras (`alta`/`media`/`baja`), la escala numérica
(`1`=alta, `2`=media, `3`=baja), las iniciales (`A`/`M`/`B`) y sinónimos como
`urgente` o `leve`. Si no viene o no se entiende, queda en `media`.

La **agencia** se busca por código o por nombre entre las del secad; la de
`--agencia` se usa para las filas que no la traigan. Es solo una sugerencia: al
recepcionar, el operador puede cambiarla.

**Opciones**

- `--actualizar` — además de crear los que faltan, corrige descripción,
  prioridad y agencia de los códigos que ya existían. Sin esta opción, los
  existentes se respetan (útil cuando el secad ya tiene ajustes propios).
- `--desactivar-faltantes` — retira (baja lógica) los códigos activos que ya no
  aparecen en el archivo. Sirve para reemplazar el listado por una versión nueva.
- `--dry-run` — valida e informa sin tocar la base.

## 2. Histórico de casos

Los casos ya atendidos del sistema anterior.

```bash
npm run importar:casos -- casos.csv --tenant envigado \
    --agencia POLICIA --canal C1 --estado cerrado --dry-run
```

**Columnas**: `referencia` (`NUME_LLAMADA`, radicado…), `fecha` (`HORA_CASO`),
`codigo` (`CODI_PEDIDO`), `titulo` (`DESCRIPCION_CASO`), `comentario`,
`ciudadano` (`NOMB_LLAMANTE`), `telefono`, `ciudad`, `barrio`, `direccion`
(`DIRE_CASO`), `lat`/`lng` (`LATITUD_CASO`/`LONGITUD_CASO`), `prioridad`,
`estado`, `agencia`, `canales` (varios separados por `|`).

Dos detalles que importan:

- **Se conserva la fecha original** de cada caso. Importarlos con la fecha de
  hoy dejaría el panel de gestión sin sentido. Se aceptan `dd/MM/yyyy HH:mm:ss`,
  `dd-MM-yyyy` e ISO-8601; si una fila no trae fecha legible, el informe lo dice.
- **La referencia del sistema de origen** es lo que impide duplicar: una
  segunda corrida del mismo archivo no inserta nada. Si el archivo no trae
  referencia, no hay forma de detectar repetidos.

Las coordenadas en `0` (habituales donde no hubo georreferenciación) se guardan
como vacías, no como un punto en el golfo de Guinea.

## Desde una base de datos, sin archivo intermedio

Si el origen es PostgreSQL, se vuelca la consulta directamente:

```bash
psql -d sistema_anterior -c "\copy (
  select codi_pedido as codigo, descripcion_caso as descripcion,
         importancia as prioridad, especialidad as agencia
  from tipificacion_casos where activo = 'S'
) to 'codigos.csv' with (format csv, header)"
```

## Verificación posterior

```sql
select count(*) from codigos_caso where tenant = 'envigado';
select prioridad, count(*) from codigos_caso where tenant='envigado' group by prioridad;
select min("creadoEn")::date, max("creadoEn")::date
  from casos where tenant='envigado' and "referenciaExterna" is not null;
```
