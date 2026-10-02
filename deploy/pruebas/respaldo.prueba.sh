#!/usr/bin/env bash
#
# Prueba de deploy/respaldo-falcon.sh contra un PostgreSQL REAL.
#
#   ./deploy/pruebas/respaldo.prueba.sh
#
# Levanta un cluster desechable, le pone un esquema con la misma forma que el
# de producción —FORCE ROW LEVEL SECURITY incluido, que es justo lo que puede
# vaciar un volcado sin avisar— y ejercita los cuatro modos del script.
#
# No sirve de nada probar el respaldo contra una base simulada: lo que puede
# fallar aquí es la conversación con pg_dump, no la lógica de bash.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
GUION="$RAIZ/deploy/respaldo-falcon.sh"
BASE_TMP="${TMPDIR:-/var/tmp}/falcon-prueba-respaldo.$$"
PUERTO=5499

ok=0; mal=0
afirmar() {
  if [[ "$2" == "$3" ]]; then printf '  ✔ %s\n' "$1"; ok=$((ok + 1))
  else printf '  ✖ %s\n      esperaba: %s\n      obtuvo:   %s\n' "$1" "$3" "$2"; mal=$((mal + 1)); fi
}
afirmar_que() {
  if [[ "$2" == 1 ]]; then printf '  ✔ %s\n' "$1"; ok=$((ok + 1))
  else printf '  ✖ %s\n' "$1"; mal=$((mal + 1)); fi
}

# ── Cluster desechable ───────────────────────────────────────────────────
BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)
[[ -n "$BIN" ]] || { echo "No hay PostgreSQL instalado (apt install postgresql)." >&2; exit 1; }

mkdir -p "$BASE_TMP"/{datos,copias}
chmod 777 "$BASE_TMP" "$BASE_TMP/datos"
chown -R postgres:postgres "$BASE_TMP/datos"

como_postgres() { su postgres -s /bin/bash -c "$1"; }
apagar() {
  como_postgres "$BIN/pg_ctl -D $BASE_TMP/datos -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$BASE_TMP"
}
trap apagar EXIT

echo "==> Cluster desechable en $BASE_TMP"
como_postgres "$BIN/initdb -D $BASE_TMP/datos -A trust --locale=C --encoding=UTF8" >/dev/null
como_postgres "$BIN/pg_ctl -D $BASE_TMP/datos -o '-p $PUERTO -k $BASE_TMP -c listen_addresses=' -l $BASE_TMP/pg.log start" >/dev/null
export PGHOST="$BASE_TMP" PGPORT="$PUERTO"
pg_isready -q || { cat "$BASE_TMP/pg.log"; exit 1; }

# ── Esquema con la forma del de producción ───────────────────────────────
psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE falcon LOGIN SUPERUSER;
CREATE ROLE falcon_sin_bypass LOGIN;
SQL
createdb -U postgres -O falcon falcon_cad

psql -U falcon -d falcon_cad -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant varchar(64) NOT NULL,
  correo varchar(200) NOT NULL,
  rol varchar(32) NOT NULL,
  "mfaSecreto" text,
  "mfaActivadoEn" timestamptz
);
CREATE TABLE casos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant varchar(64) NOT NULL,
  consecutivo int NOT NULL,
  motivo varchar(300) NOT NULL,
  "creadoEn" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE archivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant varchar(64) NOT NULL,
  "casoId" uuid NOT NULL,
  nombre varchar(200) NOT NULL,
  "tipoMime" varchar(120) NOT NULL,
  bytes bigint NOT NULL DEFAULT 0,
  estado varchar(12) NOT NULL DEFAULT 'EN_CURSO',
  origen varchar(12) NOT NULL DEFAULT 'ADJUNTO',
  usuario varchar(120) NOT NULL,
  "creadoEn" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE archivos_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant varchar(64) NOT NULL,
  "archivoId" uuid NOT NULL REFERENCES archivos(id) ON DELETE CASCADE,
  indice int NOT NULL,
  datos bytea NOT NULL,
  bytes int NOT NULL,
  "creadoEn" timestamptz NOT NULL DEFAULT now()
);

-- Lo mismo que hacen las migraciones: sin esto la prueba no reproduce la
-- condición que más fácil arruina un respaldo.
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['usuarios','casos','archivos','archivos_chunks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$CREATE POLICY tenant_isolation ON %I
      USING (tenant = current_setting('app.tenant', true))$f$, t);
    EXECUTE format('GRANT SELECT ON %I TO falcon_sin_bypass', t);
  END LOOP;
END $$;

INSERT INTO usuarios (tenant, correo, rol)
SELECT 'bogota', 'u' || g || '@falcon.co', 'operador' FROM generate_series(1, 7) g;
INSERT INTO casos (tenant, consecutivo, motivo)
SELECT 'bogota', g, 'motivo ' || g FROM generate_series(1, 23) g;

-- Tres grabaciones: dos viejas (candidatas a purga) y una de hoy. Con bytes
-- de verdad, para que el volcado completo pese y el diario no.
INSERT INTO archivos (tenant, "casoId", nombre, "tipoMime", bytes, estado, origen, usuario, "creadoEn")
SELECT 'bogota', (SELECT id FROM casos LIMIT 1), 'grab' || g || '.webm', 'video/webm',
       2097152, 'COMPLETO', 'GRABACION', 'op@falcon.co',
       now() - (CASE g WHEN 1 THEN interval '200 days' WHEN 2 THEN interval '120 days'
                       ELSE interval '1 hour' END)
  FROM generate_series(1, 3) g;
INSERT INTO archivos (tenant, "casoId", nombre, "tipoMime", bytes, estado, origen, usuario, "creadoEn")
VALUES ('bogota', (SELECT id FROM casos LIMIT 1), 'acta.pdf', 'application/pdf',
        1024, 'COMPLETO', 'ADJUNTO', 'op@falcon.co', now() - interval '300 days');

-- bytea incompresible para que -Fc no lo reduzca a nada: si el relleno fuera
-- comprimible, el diario y el completo pesarían igual y la prueba no probaría
-- nada. gen_random_bytes topa en 1024 bytes por llamada, de ahí el string_agg.
INSERT INTO archivos_chunks (tenant, "archivoId", indice, datos, bytes)
SELECT a.tenant, a.id, i, r.datos, length(r.datos)
  FROM archivos a
  CROSS JOIN generate_series(0, 1) i
  CROSS JOIN LATERAL (
    SELECT string_agg(gen_random_bytes(1024), ''::bytea) AS datos
      FROM generate_series(1, 1024)
  ) r
 WHERE a.origen = 'GRABACION';
SQL

filas() { psql -U falcon -d falcon_cad -q -tAc "SET row_security=off; SELECT count(*) FROM $1" | tr -d ' '; }
echo "    sembrado: $(filas casos) casos, $(filas usuarios) usuarios, $(filas archivos) archivos, $(filas archivos_chunks) chunks"

# ── El script bajo prueba ────────────────────────────────────────────────
COPIAS="$BASE_TMP/copias"
correr() {
  env PGHOST="$BASE_TMP" PGPORT="$PUERTO" FALCON_PG_EXEC="" \
      FALCON_RESPALDOS="$COPIAS" FALCON_BD=falcon_cad "FALCON_BD_USUARIO=${ROL:-falcon}" \
      FALCON_COPIAS_DIARIAS="${DIARIAS:-14}" FALCON_COPIAS_COMPLETAS="${COMPLETAS:-2}" \
      FALCON_COPIAS_PREDESPLIEGUE="${PREDESPLIEGUE:-3}" \
      bash "$GUION" "$@" 2>&1
}
peso() { stat -c%s "$1"; }

echo
echo "==> completo"
salida=$(correr completo) || { echo "$salida"; echo "  ✖ el modo completo falló"; mal=$((mal + 1)); }
echo "$salida" | sed 's/^/    /'
completo=$(ls "$COPIAS"/falcon-completo-*.dump 2>/dev/null | head -1 || true)
afirmar_que "deja un falcon-completo-*.dump" "$([[ -n $completo ]] && echo 1 || echo 0)"
afirmar_que "el completo pesa más de 4 MB (lleva el video)" \
  "$([[ -n $completo && $(peso "$completo") -gt 4000000 ]] && echo 1 || echo 0)"
afirmar "el .conteos registra los chunks" \
  "$(grep '^archivos_chunks=' "$completo.conteos" | cut -d= -f2)" "6"

echo
echo "==> diario"
sleep 1   # la marca de tiempo del nombre tiene minutos; ls -t usa mtime
salida=$(correr diario) || { echo "$salida"; echo "  ✖ el modo diario falló"; mal=$((mal + 1)); }
echo "$salida" | sed 's/^/    /'
diario=$(ls "$COPIAS"/falcon-datos-*.dump 2>/dev/null | head -1 || true)
afirmar_que "deja un falcon-datos-*.dump" "$([[ -n $diario ]] && echo 1 || echo 0)"
afirmar_que "el diario pesa menos de 1 MB (sin el video)" \
  "$([[ -n $diario && $(peso "$diario") -lt 1000000 ]] && echo 1 || echo 0)"
afirmar_que "la ESTRUCTURA de archivos_chunks sí va en el diario" \
  "$(pg_restore --list "$diario" | grep -qi 'TABLE archivos_chunks' && echo 1 || echo 0)"
afirmar_que "los DATOS de archivos_chunks no van en el diario" \
  "$(pg_restore --list "$diario" | grep -qi 'TABLE DATA archivos_chunks' && echo 0 || echo 1)"
afirmar_que "los DATOS de casos sí van en el diario (RLS no los vació)" \
  "$(pg_restore --list "$diario" | grep -qi 'TABLE DATA.* casos' && echo 1 || echo 0)"

echo
echo "==> verificar (restaura de verdad el más reciente: el diario)"
salida=$(correr verificar) && estado=0 || estado=1
echo "$salida" | sed 's/^/    /'
afirmar "verificar termina bien" "$estado" "0"
afirmar_que "compara contra los conteos reales (23 casos)" \
  "$(echo "$salida" | grep -q 'casos: 23 de 23' && echo 1 || echo 0)"
afirmar_que "acepta que el diario traiga archivos_chunks vacía" \
  "$(echo "$salida" | grep -q 'como corresponde al respaldo diario' && echo 1 || echo 0)"
afirmar_que "elimina la base de prueba que creó" \
  "$(psql -U falcon -d postgres -tAc "SELECT count(*) FROM pg_database WHERE datname LIKE 'verificacion_respaldo_%'" | tr -d ' ' | grep -q '^0$' && echo 1 || echo 0)"

echo
echo "==> verificar detecta un respaldo corrupto"
cp "$diario" "$COPIAS/falcon-datos-9999-12-31-2359.dump"
cp "$diario.conteos" "$COPIAS/falcon-datos-9999-12-31-2359.dump.conteos"
# A la mitad, no a un tamaño fijo: el diario pesa ~20K y un `truncate -s 60000`
# lo ESTIRA con ceros en vez de cortarlo —el respaldo seguiría íntegro y la
# prueba pasaría sin probar nada—.
truncate -s "$(( $(peso "$diario") / 2 ))" "$COPIAS/falcon-datos-9999-12-31-2359.dump"
touch "$COPIAS/falcon-datos-9999-12-31-2359.dump"
salida=$(correr verificar) && estado=0 || estado=1
afirmar "un .dump truncado hace fallar verificar" "$estado" "1"
rm -f "$COPIAS"/falcon-datos-9999-*.dump*

echo
echo "==> verificar detecta conteos que no cuadran"
cp "$diario" "$COPIAS/falcon-datos-9998-12-31-2359.dump"
sed 's/^casos=23$/casos=999/' "$diario.conteos" > "$COPIAS/falcon-datos-9998-12-31-2359.dump.conteos"
touch "$COPIAS/falcon-datos-9998-12-31-2359.dump"
salida=$(correr verificar) && estado=0 || estado=1
afirmar "faltar filas hace fallar verificar" "$estado" "1"
afirmar_que "y dice exactamente cuántas faltaron" \
  "$(echo "$salida" | grep -q 'se restauraron 23 de 999' && echo 1 || echo 0)"
rm -f "$COPIAS"/falcon-datos-9998-*.dump*

echo
echo "==> el respaldo deja su sha256 y coincide"
afirmar_que "escribe un .sha256 junto a la copia" \
  "$([[ -f "$diario.sha256" ]] && echo 1 || echo 0)"
afirmar "y es el del archivo" "$(cat "$diario.sha256")" "$(sha256sum "$diario" | cut -d' ' -f1)"

echo
echo "==> confirmar: rechaza un sha256 que no cuadra"
salida=$(correr confirmar "$(basename "$diario")" 0000000000000000000000000000000000000000000000000000000000000000) && estado=0 || estado=1
afirmar "se niega" "$estado" "1"
afirmar_que "y avisa de volver a bajarla" \
  "$(echo "$salida" | grep -q 'Vuelva a bajarla' && echo 1 || echo 0)"
afirmar "no deja la marca .afuera" "$([[ -f "$diario.afuera" ]] && echo 1 || echo 0)" "0"

echo
echo "==> rotación: los diarios rotan libres"
# Un diario es una foto de datos que SIGUEN en la base: soltar el más viejo de
# quince no borra información.
for n in 01 02 03 04 05; do cp "$diario" "$COPIAS/falcon-datos-2020-01-$n-0000.dump"; done
DIARIAS=3 correr diario >/dev/null
afirmar "conserva 3 respaldos diarios" "$(ls "$COPIAS"/falcon-datos-*.dump | wc -l)" "3"
afirmar_que "el diario más nuevo sobrevive a su propia rotación" \
  "$([[ -s $(ls -t "$COPIAS"/falcon-datos-*.dump | head -1) ]] && echo 1 || echo 0)"

echo
echo "==> rotación: un completo NO se borra si nada consta fuera del servidor"
# Es lo que materializa "ningún dato se borra nunca": un completo puede ser el
# único sitio donde queda una grabación.
sleep 1
COMPLETAS=1 correr completo >/dev/null 2>&1 || true
afirmar "siguen los 2 completos" "$(ls "$COPIAS"/falcon-completo-*.dump | wc -l)" "2"
salida=$(COMPLETAS=1 correr diario)
afirmar_que "y avisa de que retuvo una copia" \
  "$(echo "$salida" | grep -q 'retenida' && echo 1 || echo 0)"

echo
echo "==> confirmar habilita la rotación del completo viejo"
nuevo_completo=$(ls -t "$COPIAS"/falcon-completo-*.dump | head -1)
viejo_completo=$(ls -t "$COPIAS"/falcon-completo-*.dump | tail -1)
salida=$(correr confirmar "$(basename "$nuevo_completo")" "$(sha256sum "$nuevo_completo" | cut -d' ' -f1)")
afirmar_que "acepta el sha256 correcto" \
  "$(echo "$salida" | grep -q 'coincide byte a byte' && echo 1 || echo 0)"
COMPLETAS=1 correr diario >/dev/null
afirmar "ahora sí suelta el completo viejo" "$([[ -f "$viejo_completo" ]] && echo 1 || echo 0)" "0"
afirmar_que "pero conserva el confirmado" "$([[ -f "$nuevo_completo" ]] && echo 1 || echo 0)"

echo
echo "==> no existe ningún modo que borre datos por antigüedad"
salida=$(correr purgar 90 2>&1) && estado=0 || estado=1
afirmar "purgar ya no existe" "$estado" "1"
afirmar "los datos siguen intactos" "$(filas archivos)" "4"
afirmar "y los chunks también" "$(filas archivos_chunks)" "6"

echo
echo "==> espacio: informa y no toca nada"
antes_archivos=$(filas archivos); antes_chunks=$(filas archivos_chunks)
antes_copias=$(ls "$COPIAS" | wc -l)
salida=$(correr espacio) && estado=0 || estado=1
echo "$salida" | sed 's/^/    /'
afirmar "termina bien" "$estado" "0"
afirmar_que "proyecta en meses cuánto falta para el 80% del disco" \
  "$(echo "$salida" | grep -qE 'quedan ~[0-9]+ meses' && echo 1 || echo 0)"
# Salía "el disco ya pasó del 80%" con el disco al 32%: restaba `size - avail`
# para deducir lo usado, y en un sistema de archivos con reserva eso no cuadra.
pct_real=$(df --output=pcent "$COPIAS" | tail -1 | tr -dc '0-9')
afirmar_que "no avisa del 80% con el disco al ${pct_real}%" \
  "$([[ $pct_real -ge 80 ]] || ! echo "$salida" | grep -q 'pasó del 80%' && echo 1 || echo 0)"
afirmar "no borra datos" "$(filas archivos)" "$antes_archivos"
afirmar "ni chunks" "$(filas archivos_chunks)" "$antes_chunks"
afirmar "ni copias" "$(ls "$COPIAS" | wc -l)" "$antes_copias"

echo
echo "==> un pg_dump que se muere a mitad no deja basura"
# El caso real es disco lleno o contenedor reiniciado: pg_dump ya escribió
# unos cuantos MB y muere. Si el script volcara directo al nombre definitivo,
# ese archivo a medias quedaría en el directorio y `verificar` lo tomaría por
# el respaldo más reciente —tener respaldos pasaría a ser una creencia—.
cat > "$BASE_TMP/pg_a_medias" <<'W'
#!/usr/bin/env bash
if [[ "$1" == pg_dump ]]; then
  head -c 40000 /dev/zero
  echo "pg_dump: error: aborted because of server shutdown" >&2
  exit 1
fi
exec "$@"
W
chmod +x "$BASE_TMP/pg_a_medias"
salida=$(env PGHOST="$BASE_TMP" PGPORT="$PUERTO" FALCON_PG_EXEC="$BASE_TMP/pg_a_medias"   FALCON_RESPALDOS="$COPIAS" FALCON_BD=falcon_cad FALCON_BD_USUARIO=falcon   bash "$GUION" diario 2>&1) && estado=0 || estado=1
afirmar "el respaldo falla" "$estado" "1"
# Contar archivos no basta: el nombre lleva la marca al minuto, así que un
# volcado a medias del mismo minuto SOBRESCRIBE al bueno sin cambiar la cuenta.
# Lo que hay que exigir es que todo lo que quedó en el directorio sea legible.
ilegibles=0
for d in "$COPIAS"/falcon-*.dump; do
  pg_restore --list "$d" >/dev/null 2>&1 || ilegibles=$((ilegibles + 1))
done
afirmar "ningún respaldo del directorio quedó ilegible" "$ilegibles" "0"
afirmar "ni un .parcial tirado" "$(ls "$COPIAS"/*.parcial 2>/dev/null | wc -l)" "0"

echo
echo "==> un rol que no puede saltarse RLS falla ANTES de escribir"
antes=$(ls "$COPIAS"/falcon-datos-*.dump | wc -l)
salida=$(ROL=falcon_sin_bypass correr diario) && estado=0 || estado=1
afirmar "el respaldo falla" "$estado" "1"
afirmar_que "y nombra row-level security como causa" \
  "$(echo "$salida" | grep -qi 'row-level security\|BYPASSRLS' && echo 1 || echo 0)"
afirmar "no deja ningún .dump nuevo" "$(ls "$COPIAS"/falcon-datos-*.dump | wc -l)" "$antes"
afirmar "ni un .parcial tirado" "$(ls "$COPIAS"/*.parcial 2>/dev/null | wc -l)" "0"

echo
echo "────────────────────────────────────────"
echo "$ok comprobaciones bien, $mal mal"
[[ "$mal" == 0 ]]
