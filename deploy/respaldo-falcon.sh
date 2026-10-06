#!/usr/bin/env bash
#
# Respaldo de FALCON CAD.
#
#   ./respaldo-falcon.sh                  # diario: todo MENOS el video
#   ./respaldo-falcon.sh completo         # incluye las grabaciones
#   ./respaldo-falcon.sh verificar        # restaura el último respaldo y comprueba que sirve
#   ./respaldo-falcon.sh confirmar <copia> <sha256>   # "ya la bajé a mi disco, y coincide"
#   ./respaldo-falcon.sh espacio          # cuánto crece y cuánto falta para llenar el disco
#
# LA POLÍTICA, EN UNA FRASE
#
# Ningún dato se borra nunca. Lo que se rota son COPIAS, que es otra cosa.
#
#   · Un respaldo DIARIO es una foto de datos que siguen vivos en la base.
#     Guardar quince y soltar la decimosexta no pierde información: la
#     información está en la base, la copia solo servía para volver atrás.
#
#   · Un respaldo COMPLETO lleva además las grabaciones que todavía están en la
#     base, así que se trata con más cuidado: NO se rota mientras no conste que
#     salió del servidor —o lo subió (`.subido`), o alguien lo bajó y lo
#     confirmó con su sha256 (`.afuera`)—. Si no consta, avisa y no borra.
#
#   · El hogar permanente del video NO es este volcado: es el almacenamiento de
#     objetos donde ArchivadoService deja cada grabación a los 90 días, después
#     de bajarla de vuelta y comprobar que coincide byte a byte. Ese bucket hay
#     que bajarlo al disco externo igual que estos respaldos. El índice de qué
#     objeto es cada grabación y con qué sha256 va en la tabla `archivos`, o sea
#     en todos los respaldos diarios.
#
# Aquí no hay ningún modo que borre datos por antigüedad, a propósito.
#
# POR QUÉ DOS RESPALDOS DISTINTOS
#
# Las grabaciones viven dentro de la base, en `archivos_chunks`. Eso es cómodo
# —un volcado se lleva todo— hasta que el video pesa más que los datos: un
# volcado completo de 50 GB no se puede hacer a diario, ni guardar quince
# copias, ni bajarlo por una conexión normal.
#
# Separar los dos respaldos convierte lo irreemplazable —casos, usuarios,
# catálogos, configuración, enrolamientos del doble factor— en unos pocos MB
# que sí se pueden copiar todos los días y guardar quince veces. El video se
# respalda aparte, se baja aparte, y se conserva para siempre aparte.
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

# Quince copias diarias: la política es "siempre hay quince"; al hacer la
# dieciseisava, la primera sale. Los `predespliegue-*.dump` los deja
# deploy-falcon.sh antes de cada despliegue y son completos: si nadie los rota,
# crecen hasta llenar el disco.
COPIAS_DIARIAS="${FALCON_COPIAS_DIARIAS:-15}"
COPIAS_COMPLETAS="${FALCON_COPIAS_COMPLETAS:-2}"
COPIAS_PREDESPLIEGUE="${FALCON_COPIAS_PREDESPLIEGUE:-3}"

# El .env lo carga EL SCRIPT, no quien lo llama.
#
# `cron` arranca con un entorno casi vacío: no hereda nada de la sesión ni lee
# ningún .env. Cuando esto dependía de quien invocaba, el respaldo nocturno se
# hacía bien y NO SUBÍA NADA — y el aviso salía por stderr, a un correo que
# nadie lee. Un respaldo que no sale del servidor no protege de perder el
# servidor, que es de lo único que de verdad protege un respaldo.
#
# Se leen solo líneas `FALCON_*=valor`, sin ejecutar el archivo: un `.env` no
# es un script y no tiene por qué poder correr nada. Lo que ya venga en el
# entorno MANDA sobre el archivo, para poder sobrescribirlo en una llamada
# suelta sin editar nada.
cargar_env() {
  local archivo="$1"
  [[ -r "$archivo" ]] || return 0
  local linea clave valor
  while IFS= read -r linea || [[ -n "$linea" ]]; do
    [[ "$linea" =~ ^[[:space:]]*FALCON_[A-Z0-9_]+= ]] || continue
    clave="${linea%%=*}"; clave="${clave//[[:space:]]/}"
    valor="${linea#*=}"
    # Quitar comillas envolventes, si las trae.
    [[ "$valor" == \"*\" || "$valor" == \'*\' ]] && valor="${valor:1:${#valor}-2}"
    [[ -n "${!clave:-}" ]] || printf -v "$clave" '%s' "$valor"
    export "${clave?}"
  done < "$archivo"
}
cargar_env "$DEPLOY_DIR/.env"

# Un respaldo que solo vive en el servidor que respalda no es un respaldo: si
# se pierde la máquina, se pierden los dos. Si está definida, se sube a una URL
# prefirmada de Oracle Object Storage (PAR), que no exige instalar nada.
URL_REMOTA="${FALCON_RESPALDO_URL:-}"

MODO="${1:-diario}"
case "$MODO" in
  diario|completo|verificar|confirmar|espacio) ;;
  *) echo "Uso: $0 [diario|completo|verificar|confirmar <copia> <sha256>|espacio]" >&2; exit 1 ;;
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

# ── Confirmar que una copia ya está fuera del servidor ───────────────────
# Esto es lo que convierte "creo que la bajé" en un hecho comprobado, y lo que
# habilita a la rotación a soltar un completo viejo. El sha256 lo calcula usted
# en el disco donde quedó la copia:
#   Linux/macOS:  shasum -a 256 falcon-completo-....dump
#   Windows:      certutil -hashfile falcon-completo-....dump SHA256
if [[ "$MODO" == confirmar ]]; then
  nombre="${2:-}"; suyo=$(echo "${3:-}" | tr 'A-Z' 'a-z' | limpio)
  [[ -n "$nombre" && -n "$suyo" ]] || {
    echo "Uso: $0 confirmar <nombre-de-la-copia> <sha256-de-su-disco>" >&2; exit 1; }
  copia="$DESTINO/$(basename "$nombre")"
  [[ -f "$copia" ]] || { echo "✖ No existe $copia." >&2; exit 1; }

  mio=$(sha256sum "$copia" | cut -d' ' -f1)
  if [[ "$mio" != "$suyo" ]]; then
    echo "✖ NO coinciden. La copia que bajó está distinta de la del servidor." >&2
    echo "    servidor: $mio" >&2
    echo "    su disco: $suyo" >&2
    echo "  Vuelva a bajarla. No se marcó nada." >&2
    exit 1
  fi
  : > "$copia.afuera"
  echo "✔ $(basename "$copia") coincide byte a byte con su copia."
  echo "  Marcada como respaldada fuera del servidor; la rotación ya puede soltarla."
  exit 0
fi

# ── Espacio: cuánto crece y cuánto falta ─────────────────────────────────
# No borra nada ni toca nada. Es para no enterarse del límite el día que llega.
if [[ "$MODO" == espacio ]]; then
  bd=$(psql_ "SELECT pg_size_pretty(pg_database_size('$BD'))" | limpio)
  video=$(psql_ "SELECT pg_size_pretty(pg_total_relation_size('archivos_chunks'))" | limpio)
  mes=$(psql_ "SET row_security = off;
    SELECT coalesce(sum(bytes), 0) FROM archivos
     WHERE origen = 'GRABACION' AND \"creadoEn\" > now() - interval '30 days'" | limpio)

  libre_k=$(df --output=avail "$DESTINO" | tail -1 | tr -dc '0-9')
  total_k=$(df --output=size "$DESTINO" | tail -1 | tr -dc '0-9')
  # `usado` de df, no `size - avail`: en sistemas de archivos con reserva o
  # superpuestos esas dos cuentas no cuadran, y restando salía un margen
  # negativo que hacía avisar de un disco al 80% estando al 32%.
  usado_k=$(df --output=used "$DESTINO" | tail -1 | tr -dc '0-9')
  pct=$(df --output=pcent "$DESTINO" | tail -1 | tr -dc '0-9')

  echo "Base de datos         $bd"
  echo "  de eso, video       $video"
  echo "Disco                 $(( total_k / 1024 / 1024 )) GB totales, $(( libre_k / 1024 / 1024 )) GB libres, al ${pct}%"
  echo "Grabado últimos 30 d  $(psql_ "SELECT pg_size_pretty($mes::bigint)" | limpio)"
  echo

  # El margen útil se cuenta hasta el 80%, no hasta el 100%: un disco al 95%
  # con PostgreSQL encima no es "casi lleno", es una caída esperando turno.
  margen_k=$(( total_k * 80 / 100 - usado_k ))
  if [[ "$pct" -ge 80 ]]; then
    echo "⚠ El disco ya pasó del 80%. Hay que sacar video del servidor ya." >&2
  elif [[ "$mes" -le 0 ]]; then
    echo "No se grabó nada en los últimos 30 días: sin ritmo no hay proyección."
  elif [[ "$margen_k" -le 0 ]]; then
    echo "⚠ Ya no queda margen hasta el 80% del disco." >&2
  else
    meses=$(( margen_k * 1024 / mes ))
    echo "Al ritmo de los últimos 30 días quedan ~$meses meses antes del 80% del disco."
    [[ "$meses" -le 6 ]] && echo "  ⚠ Menos de seis meses. Es hora de sacar el video del servidor." >&2
  fi
  exit 0
fi

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

# ── Respaldar ────────────────────────────────────────────────────────────
# Con segundos: dos respaldos del mismo minuto tendrían el mismo nombre y el
# segundo sobrescribiría al primero sin decir nada. Los `predespliegue-*` ya los
# llevaban.
marca=$(date +%F-%H%M%S)
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
# El sha256 es lo que después permite comprobar que la copia bajada al disco
# externo llegó íntegra, sin volver a subirla para compararla.
sha256sum "$archivo" | cut -d' ' -f1 > "$archivo.sha256"
echo "    $(basename "$archivo")  ($(du -h "$archivo" | cut -f1))" \
     "· ${antes[casos]} casos, ${antes[usuarios]} usuarios, ${antes[archivos]} archivos"
echo "    sha256 $(cat "$archivo.sha256")"

# ── Fuera del servidor ───────────────────────────────────────────────────
if [[ -n "$URL_REMOTA" ]]; then
  echo "==> Subiendo fuera del servidor"
  subido=1
  for suelto in "$archivo" "$archivo.conteos" "$archivo.sha256"; do
    curl -fsS --max-time 900 -T "$suelto" "${URL_REMOTA%/}/$(basename "$suelto")" >/dev/null || subido=0
  done
  if [[ "$subido" == 1 ]]; then
    : > "$archivo.subido"
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
# Rotar NO es borrar datos. Son dos casos distintos:
#
#   · Un DIARIO es una foto de datos que siguen vivos en la base. Soltar el más
#     viejo de quince no pierde información: la base la tiene.
#
#   · Un COMPLETO lleva además las grabaciones que siguen en la base. Se puede
#     soltar uno viejo cuando existe otro MÁS NUEVO que ya consta fuera del
#     servidor. Si no hay ninguno confirmado, no se borra nada y se avisa.
#
# ⚠ Con el archivado en marcha, un completo nuevo ya NO contiene las grabaciones
#   que se archivaron entre uno y otro: no es superconjunto del viejo. Lo que
#   hace seguro soltarlo es otra cosa —ArchivadoService libera los bytes de una
#   grabación solo DESPUÉS de bajarla del almacenamiento de objetos y comprobar
#   que coincide byte a byte—. Esa copia es el hogar permanente del video, no
#   este volcado, y por eso ese bucket también hay que bajarlo al disco externo.
referencia_externa() {
  local c
  for c in $(ls -t "$DESTINO"/falcon-completo-*.dump 2>/dev/null); do
    if [[ -f "$c.subido" || -f "$c.afuera" ]]; then stat -c%Y "$c"; return 0; fi
  done
  return 1
}
CORTE_EXTERNO=$(referencia_externa) || CORTE_EXTERNO=''

rotar() {
  local patron="$1" conservar="$2" exigir_copia="${3:-no}" sobran
  sobran=$(ls -t "$DESTINO"/$patron 2>/dev/null | tail -n +"$((conservar + 1))") || true
  [[ -z "$sobran" ]] && return 0
  local sueltos=0 retenidos=0
  while IFS= read -r viejo; do
    if [[ "$exigir_copia" == si ]]; then
      if [[ -z "$CORTE_EXTERNO" ]] || [[ "$(stat -c%Y "$viejo")" -ge "$CORTE_EXTERNO" ]]; then
        retenidos=$((retenidos + 1))
        echo "    ⚠ $(basename "$viejo") sobra por antigüedad, pero no hay un respaldo" >&2
        echo "      completo MÁS NUEVO que conste fuera del servidor. No se borra." >&2
        continue
      fi
    fi
    rm -f "$viejo" "$viejo.conteos" "$viejo.sha256" "$viejo.subido" "$viejo.afuera"
    sueltos=$((sueltos + 1))
  done <<< "$sobran"
  [[ "$sueltos" -gt 0 ]] && echo "    Rotación: eliminada(s) $sueltos copia(s) de $patron"
  if [[ "$retenidos" -gt 0 ]]; then
    echo "    Rotación: $retenidos copia(s) retenida(s) hasta que una más nueva salga del servidor." >&2
    echo "      Bájela a su disco y confírmela:  $0 confirmar <copia> <sha256>" >&2
  fi
  return 0
}
rotar 'falcon-datos-*.dump' "$COPIAS_DIARIAS"
rotar 'falcon-completo-*.dump' "$COPIAS_COMPLETAS" si
rotar 'predespliegue-*.dump' "$COPIAS_PREDESPLIEGUE" si

# ── Aviso de disco ───────────────────────────────────────────────────────
# Quedarse sin disco en un CAD es una caída, no una molestia.
usado=$(df --output=pcent "$DESTINO" | tail -1 | tr -dc '0-9')
tamano_bd=$(psql_ "SELECT pg_size_pretty(pg_database_size('$BD'))" 2>/dev/null | limpio) || tamano_bd='?'
tamano_video=$(psql_ "SELECT pg_size_pretty(pg_total_relation_size('archivos_chunks'))" 2>/dev/null | limpio) || tamano_video='?'

echo
echo "Base: $tamano_bd · grabaciones: $tamano_video · disco al ${usado}%"
if [[ "$usado" -ge 80 ]]; then
  echo "    ⚠ El disco va al ${usado}%. Vea '$0 espacio'." >&2
fi
