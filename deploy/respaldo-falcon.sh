#!/usr/bin/env bash
#
# Respaldo de FALCON CAD.
#
#   ./respaldo-falcon.sh              # diario: todo MENOS el video
#   ./respaldo-falcon.sh completo     # incluye las grabaciones
#   ./respaldo-falcon.sh verificar    # restaura el último respaldo y comprueba que sirve
#   ./respaldo-falcon.sh purgar 90    # qué grabaciones de más de 90 días se podrían borrar
#   ./respaldo-falcon.sh purgar 90 --ejecutar   # borrarlas de verdad
#
# POR QUÉ DOS RESPALDOS DISTINTOS
#
# Las grabaciones viven dentro de la base, en `archivos_chunks`. Eso es cómodo
# —un volcado se lleva todo— hasta que el video pesa más que los datos: un
# volcado completo de 50 GB no se puede hacer a diario, ni guardar catorce
# copias, ni subir a ningún lado.
#
# Separar los dos respaldos convierte lo irreemplazable —casos, usuarios,
# catálogos, configuración, enrolamientos del doble factor— en unos pocos MB
# que sí se pueden copiar todos los días, guardar muchos y mandar fuera del
# servidor. El video se respalda aparte y con menos frecuencia, que es lo que
# su valor justifica.
#
# QUÉ COMPRUEBA, Y POR QUÉ ESO IMPORTA MÁS QUE EL VOLCADO
#
# Un volcado que nadie restauró no es un respaldo, es un archivo. Casi todas
# las tablas de FALCON CAD llevan FORCE ROW LEVEL SECURITY: si el rol de la
# base dejara de poder saltarse RLS, `pg_dump` fallaría —o, en el peor caso,
# un volcado se vería normal con tablas vacías por dentro—. Por eso cada
# respaldo deja al lado un `.conteos` con cuántas filas tenía la base viva, y
# `verificar` restaura de verdad en una base desechable y exige que los
# números coincidan. Sin eso, "tengo respaldos" es una creencia, no un hecho.
set -euo pipefail

DESTINO_PREFERIDO="${FALCON_RESPALDOS:-/opt/falcon-backups}"
DEPLOY_DIR="${FALCON_DEPLOY_DIR:-$HOME/falcon-deploy}"
BD="${FALCON_BD:-falcon_cad}"
USUARIO_BD="${FALCON_BD_USUARIO:-falcon}"

# Cuántas copias se conservan aquí. El respaldo pequeño es diario y pesa poco,
# así que se guardan dos semanas; el completo es semanal y pesa, así que dos.
# Los `predespliegue-*.dump` los deja deploy-falcon.sh antes de cada despliegue
# y son completos: si nadie los rota, crecen hasta llenar el disco.
COPIAS_DIARIAS="${FALCON_COPIAS_DIARIAS:-14}"
COPIAS_COMPLETAS="${FALCON_COPIAS_COMPLETAS:-2}"
COPIAS_PREDESPLIEGUE="${FALCON_COPIAS_PREDESPLIEGUE:-3}"

# Un respaldo que solo vive en el servidor que respalda no es un respaldo: si
# se pierde la máquina, se pierden los dos. Se sube a una URL prefirmada de
# Oracle Object Storage (PAR), que no exige instalar ni configurar nada.
URL_REMOTA="${FALCON_RESPALDO_URL:-}"

MODO="${1:-diario}"
case "$MODO" in
  diario|completo|verificar|purgar) ;;
  *) echo "Uso: $0 [diario|completo|verificar|purgar <días> [--ejecutar]]" >&2; exit 1 ;;
esac

# ── Cómo se alcanza PostgreSQL ───────────────────────────────────────────
# En el servidor la base vive en el contenedor `postgres` del compose, así que
# las herramientas se ejecutan dentro. FALCON_PG_EXEC permite sustituir ese
# prefijo —en vacío, `pg_dump` y compañía corren directo— y es lo que usa
# deploy/pruebas/respaldo.prueba.sh para ejercitar este script contra un
# PostgreSQL real. Sin esa costura el respaldo solo se podría probar en
# producción, que es el único sitio donde no se debe probar nada.
if [[ -n "${FALCON_PG_EXEC+definida}" ]]; then
  PG=()
  # shellcheck disable=SC2206
  [[ -n "$FALCON_PG_EXEC" ]] && PG=($FALCON_PG_EXEC)
else
  PG=(docker compose exec -T postgres)
  cd "$DEPLOY_DIR" 2>/dev/null || { echo "No encuentro $DEPLOY_DIR." >&2; exit 1; }
fi

# El destino tiene que existir y ser escribible; si /opt no lo es, se cae a
# $HOME igual que deploy-falcon.sh, para que las dos herramientas dejen las
# copias en el mismo sitio y la rotación las vea todas.
DESTINO="$DESTINO_PREFERIDO"
if ! mkdir -p "$DESTINO" 2>/dev/null || [[ ! -w "$DESTINO" ]]; then
  DESTINO="$HOME/falcon-backups"
  mkdir -p "$DESTINO"
  echo "    (sin permiso en $DESTINO_PREFERIDO; se usa $DESTINO)"
fi

# -q a propósito: sin él, psql imprime el tag de cada sentencia, y un
# "SET row_security = off;" delante de la consulta devolvería "SET23" en vez
# de 23. Lo descubrió deploy/pruebas/respaldo.prueba.sh.
psql_() { "${PG[@]}" psql -U "$USUARIO_BD" -d "${2:-$BD}" -v ON_ERROR_STOP=1 -q -tAc "$1"; }
limpio() { tr -d '[:space:]'; }

# Contar con row_security apagado a propósito: así este número es el mismo
# universo de filas que va a volcar pg_dump. Si el rol no puede saltarse RLS,
# esto falla aquí —antes de escribir nada— en vez de dejar un respaldo que
# parece bueno y por dentro no tiene casos.
contar() {
  local tabla="$1" base="${2:-$BD}"
  "${PG[@]}" psql -U "$USUARIO_BD" -d "$base" -v ON_ERROR_STOP=1 -q -tAc \
    "SET row_security = off; SELECT count(*) FROM $tabla" | limpio
}

TABLAS_TESTIGO=(casos usuarios archivos archivos_chunks)

# ── Verificar: restaurar de verdad ───────────────────────────────────────
if [[ "$MODO" == verificar ]]; then
  ultimo=$(ls -t "$DESTINO"/falcon-*.dump 2>/dev/null | head -1) || true
  [[ -n "${ultimo:-}" ]] || { echo "No hay ningún respaldo en $DESTINO." >&2; exit 1; }
  conteos="$ultimo.conteos"

  echo "==> Verificando $(basename "$ultimo")"
  prueba="verificacion_respaldo_$$"
  psql_ "CREATE DATABASE $prueba" postgres >/dev/null
  limpiar() { psql_ "DROP DATABASE IF EXISTS $prueba" postgres >/dev/null 2>&1 || true; }
  trap limpiar EXIT

  # pg_restore se queja de la extensión pgcrypto y de dueños que no existen en
  # la base desechable. Eso no invalida nada: lo que importa es si los DATOS
  # quedaron, y de eso se encarga la comparación de abajo.
  if ! "${PG[@]}" pg_restore -U "$USUARIO_BD" -d "$prueba" --no-owner < "$ultimo" 2>/dev/null; then
    echo "    (pg_restore reportó avisos; se comprueba el contenido igual)"
  fi

  fallo=0
  for tabla in "${TABLAS_TESTIGO[@]}"; do
    restaurado=$(contar "$tabla" "$prueba" 2>/dev/null) || restaurado=''
    if [[ -z "$restaurado" ]]; then
      echo "    ✖ $tabla no existe en la base restaurada." >&2
      fallo=1; continue
    fi

    if [[ ! -f "$conteos" ]]; then
      echo "    · $tabla: $restaurado fila(s) restauradas (sin .conteos con que comparar)"
      continue
    fi
    esperado=$(grep -E "^$tabla=" "$conteos" | cut -d= -f2 | limpio) || esperado=''
    if [[ "$tabla" == archivos_chunks && "$(basename "$ultimo")" == falcon-datos-* ]]; then
      # El respaldo diario omite los bytes del video a propósito: aquí lo
      # correcto es 0, y que la TABLA exista para que la aplicación arranque.
      if [[ "$restaurado" == 0 ]]; then
        echo "    · archivos_chunks: vacía, como corresponde al respaldo diario"
      else
        echo "    ✖ archivos_chunks trae $restaurado fila(s): el diario no debería llevar video." >&2
        fallo=1
      fi
      continue
    fi
    if [[ "$restaurado" == "$esperado" ]]; then
      echo "    ✔ $tabla: $restaurado de $esperado"
    else
      echo "    ✖ $tabla: se restauraron $restaurado de $esperado filas." >&2
      fallo=1
    fi
  done

  if [[ "$fallo" != 0 ]]; then
    echo "    ✖ El respaldo NO sirve para restaurar. Revíselo hoy." >&2
    exit 1
  fi
  echo "    ✔ Restauración completa y verificada."
  exit 0
fi

# ── Purgar grabaciones viejas ────────────────────────────────────────────
# Lo único que crece sin techo es el video. Esto es lo que mantiene el disco
# bajo control, pero borra evidencia: por eso no tiene retención por defecto
# —el plazo lo decide quien responde por la evidencia, no este script—, no
# borra nada sin --ejecutar, y se niega a borrar lo que ningún respaldo
# completo haya guardado todavía.
if [[ "$MODO" == purgar ]]; then
  dias="${2:-}"
  [[ "$dias" =~ ^[0-9]+$ && "$dias" -ge 1 ]] || {
    echo "Uso: $0 purgar <días> [--ejecutar]" >&2
    echo "  No hay plazo por defecto a propósito: decídalo y escríbalo." >&2
    exit 1
  }
  ejecutar=0
  [[ "${3:-}" == --ejecutar ]] && ejecutar=1

  completo=$(ls -t "$DESTINO"/falcon-completo-*.dump 2>/dev/null | head -1) || true
  if [[ -z "${completo:-}" ]]; then
    echo "✖ No hay ningún respaldo completo en $DESTINO." >&2
    echo "  Borrar grabaciones que nadie respaldó es perderlas. Corra primero:" >&2
    echo "      $0 completo" >&2
    exit 1
  fi
  corte_respaldo=$(date -u -d "@$(stat -c%Y "$completo")" +'%Y-%m-%d %H:%M:%S+00')
  echo "==> Último respaldo completo: $(basename "$completo") ($corte_respaldo UTC)"

  # Dos condiciones, y la del respaldo manda: una grabación se borra solo si
  # además de ser vieja está dentro de ese respaldo completo.
  donde="origen = 'GRABACION'
         AND \"creadoEn\" < now() - interval '$dias days'
         AND \"creadoEn\" < timestamptz '$corte_respaldo'"

  resumen=$(psql_ "SET row_security = off;
    SELECT count(*) || '|' || coalesce(pg_size_pretty(sum(bytes)), '0 bytes')
      FROM archivos WHERE $donde") || resumen='0|0 bytes'
  cuantas=${resumen%%|*}; pesan=${resumen##*|}

  if [[ "${cuantas:-0}" == 0 ]]; then
    echo "    Nada que purgar: ninguna grabación de más de $dias días está ya respaldada."
    exit 0
  fi
  echo "    $cuantas grabación(es) de más de $dias días, $pesan"

  if [[ "$ejecutar" != 1 ]]; then
    echo "    (ensayo: no se borró nada. Añada --ejecutar para borrarlas)"
    exit 0
  fi

  # Se borra la fila de `archivos`; los trozos se van por ON DELETE CASCADE.
  # Queda constancia en el log de la aplicación de que la grabación existió:
  # lo que se borra son los bytes, no el caso.
  borradas=$(psql_ "SET row_security = off;
    WITH ido AS (DELETE FROM archivos WHERE $donde RETURNING 1)
    SELECT count(*) FROM ido" | limpio)
  echo "    ✔ Borradas $borradas grabación(es)."
  psql_ "VACUUM (ANALYZE) archivos_chunks" >/dev/null 2>&1 || true
  echo "    Base ahora: $(psql_ "SELECT pg_size_pretty(pg_database_size('$BD'))" | limpio)"
  exit 0
fi

# ── Respaldar ────────────────────────────────────────────────────────────
marca=$(date +%F-%H%M)
if [[ "$MODO" == diario ]]; then
  archivo="$DESTINO/falcon-datos-$marca.dump"
  # --exclude-table-data y NO --exclude-table: la ESTRUCTURA de la tabla sí va,
  # para que al restaurar la aplicación arranque; lo que se omite son los bytes
  # del video. Si se omitiera la tabla entera, la base restaurada no serviría.
  opciones=(--exclude-table-data=archivos_chunks)
  que="datos (sin las grabaciones)"
else
  archivo="$DESTINO/falcon-completo-$marca.dump"
  opciones=()
  que="TODO, incluidas las grabaciones"
fi

echo "==> Respaldando $que"

# Contar ANTES del volcado y guardarlo al lado. Es lo que después permite a
# `verificar` decir "se restauraron 812 de 812" en vez de "se restauró algo".
declare -A antes=()
for tabla in "${TABLAS_TESTIGO[@]}"; do
  if ! antes[$tabla]=$(contar "$tabla"); then
    echo "    ✖ No pude contar $tabla." >&2
    echo "      Si el error menciona row-level security, el rol '$USUARIO_BD' perdió" >&2
    echo "      BYPASSRLS y pg_dump tampoco podría volcar esas tablas." >&2
    exit 1
  fi
done

# Se escribe a un nombre provisional: un pg_dump que falla a medias dejaría
# si no un .dump truncado en el directorio, y `verificar` lo tomaría por el
# respaldo más reciente.
parcial="$archivo.parcial"
borrar_parcial() { rm -f "$parcial"; }
trap borrar_parcial EXIT
if ! "${PG[@]}" pg_dump -U "$USUARIO_BD" -d "$BD" -Fc "${opciones[@]}" > "$parcial"; then
  echo "    ✖ pg_dump falló. No se dejó ningún respaldo a medias." >&2
  exit 1
fi

# Un respaldo vacío o truncado es peor que ninguno: da la sensación de estar
# cubierto. Se comprueba que pg_restore pueda al menos leer su índice.
bytes=$(stat -c%s "$parcial")
if [[ "$bytes" -lt 10000 ]] || ! "${PG[@]}" pg_restore --list < "$parcial" >/dev/null 2>&1; then
  echo "    ✖ El respaldo salió vacío o ilegible ($bytes bytes). Se descarta." >&2
  exit 1
fi
mv "$parcial" "$archivo"
trap - EXIT

: > "$archivo.conteos"
for tabla in "${TABLAS_TESTIGO[@]}"; do
  echo "$tabla=${antes[$tabla]}" >> "$archivo.conteos"
done
echo "    $(basename "$archivo")  ($(du -h "$archivo" | cut -f1))" \
     "· ${antes[casos]} casos, ${antes[usuarios]} usuarios, ${antes[archivos]} archivos"

# ── Fuera del servidor ───────────────────────────────────────────────────
if [[ -n "$URL_REMOTA" ]]; then
  echo "==> Subiendo fuera del servidor"
  subido=1
  for destino in "$archivo" "$archivo.conteos"; do
    curl -fsS --max-time 900 -T "$destino" "${URL_REMOTA%/}/$(basename "$destino")" >/dev/null || subido=0
  done
  if [[ "$subido" == 1 ]]; then
    echo "    ✔ Subido"
  else
    # No se aborta: el respaldo local YA existe y es mejor que nada. Pero se
    # grita, porque un respaldo que no sale del servidor no protege de perder
    # el servidor, que es justamente de lo que protege un respaldo.
    echo "    ✖ NO se pudo subir. El respaldo quedó SOLO en este servidor." >&2
  fi
else
  echo "    ⚠ FALCON_RESPALDO_URL no está configurada: el respaldo queda solo aquí." >&2
  echo "      Si se pierde esta máquina, se pierde también el respaldo." >&2
fi

# ── Rotación ─────────────────────────────────────────────────────────────
rotar() {
  local patron="$1" conservar="$2" sobran
  sobran=$(ls -t "$DESTINO"/$patron 2>/dev/null | tail -n +"$((conservar + 1))") || true
  [[ -z "$sobran" ]] && return 0
  while IFS= read -r viejo; do
    rm -f "$viejo" "$viejo.conteos"
  done <<< "$sobran"
  echo "    Rotación: eliminada(s) $(echo "$sobran" | wc -l) copia(s) de $patron"
}
rotar 'falcon-datos-*.dump' "$COPIAS_DIARIAS"
rotar 'falcon-completo-*.dump' "$COPIAS_COMPLETAS"
rotar 'predespliegue-*.dump' "$COPIAS_PREDESPLIEGUE"

# ── Aviso de disco ───────────────────────────────────────────────────────
# Quedarse sin disco en un CAD es una caída, no una molestia.
usado=$(df --output=pcent "$DESTINO" | tail -1 | tr -dc '0-9')
tamano_bd=$(psql_ "SELECT pg_size_pretty(pg_database_size('$BD'))" 2>/dev/null | limpio) || tamano_bd='?'
tamano_video=$(psql_ "SELECT pg_size_pretty(pg_total_relation_size('archivos_chunks'))" 2>/dev/null | limpio) || tamano_video='?'

echo
echo "Base: $tamano_bd · grabaciones: $tamano_video · disco al ${usado}%"
if [[ "$usado" -ge 80 ]]; then
  echo "    ⚠ El disco va al ${usado}%. Purgue grabaciones: $0 purgar <días>" >&2
fi
