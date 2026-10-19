#!/usr/bin/env bash
#
# activar-grabacion.sh — enciende la grabación de llamadas en la centralita
# INSTALADA A MANO, sin migrarla al contenedor.
#
# Se ejecuta en el servidor de Asterisk, como root:
#
#   cd /tmp/falcon-ast && git pull
#   sudo bash deploy/asterisk/activar-grabacion.sh
#
# ─────────────────────────────────────────────────────────────────────────────
# POR QUÉ EXISTE ESTE SCRIPT
#
# La planta que FALCON genera (Plataforma → Nuestras centralitas → Aplicar)
# ya trae la grabación resuelta, pero aplicarla es una MIGRACIÓN: pasa a un
# contenedor y mueve al navegador detrás de nginx, lo que exige un nombre DNS
# y un certificado comodín. Eso se hace cuando se pueda.
#
# Mientras, la grabación es lo único nuevo que vale la pena en esta máquina, y
# cabe en tres archivos y una línea del dialplan. Esto hace exactamente eso.
#
# ─────────────────────────────────────────────────────────────────────────────
# QUÉ TOCA, Y QUÉ NO
#
#   escribe  /etc/asterisk/falcon-api.conf      credencial para SUBIR
#   escribe  /etc/asterisk/subir-grabacion.sh   lo que corre al terminar
#   edita    /etc/asterisk/extensions.conf      UNA línea, con respaldo
#   crea     /var/spool/asterisk/monitor/       donde se graba
#
# NO toca pjsip.conf, ni el puerto SIP, ni la troncal, ni los módulos. NO
# reinicia Asterisk: solo recarga el dialplan, que es lo único que cambia.
# NO rota ninguna credencial: reutiliza la API key que esta centralita YA
# tiene, así que el webhook sigue funcionando igual.
#
# Es idempotente: correrlo dos veces no duplica la línea ni pierde el
# respaldo del primer intento.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

# Las rutas salen de variables para poder PROBAR este script contra un
# /etc/asterisk de mentira antes de correrlo en el servidor. En el servidor no
# hay que ponerle nada: los valores por defecto son los reales.
ETC="${FALCON_ETC:-/etc/asterisk}"
MONITOR="${FALCON_MONITOR:-/var/spool/asterisk/monitor}"
DIALPLAN="$ETC/extensions.conf"
WEBHOOK="$ETC/falcon-webhook.conf"
API="$ETC/falcon-api.conf"
SUBIR="$ETC/subir-grabacion.sh"

if [ -z "${FALCON_PRUEBA:-}" ] && [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "Ejecútelo como root: sudo bash $0" >&2
  exit 1
fi

[ -f "$DIALPLAN" ] || { echo "No encuentro $DIALPLAN. ¿Es este el servidor de la centralita?" >&2; exit 1; }

# ── La API key: la que esta centralita ya usa ────────────────────────────────
#
# De `falcon-webhook.conf` si existe, y si no del propio dialplan —una
# instalación anterior a ese archivo llevaba la llave en la línea de
# `System()`—. NO se pide por teclado ni se pasa por argumento: lo que se
# escribe en una línea de comandos queda en el historial del shell.
LLAVE=""
ORIGEN_LLAVE=""
if [ -f "$WEBHOOK" ]; then
  LLAVE="$(grep -oE 'x-api-key:[[:space:]]*[^"]+' "$WEBHOOK" | head -1 | sed 's/^x-api-key:[[:space:]]*//')"
  [ -n "$LLAVE" ] && ORIGEN_LLAVE="de falcon-webhook.conf"
fi
if [ -z "$LLAVE" ]; then
  LLAVE="$(grep -oE 'x-api-key:[[:space:]]*[^"'"'"']+' "$DIALPLAN" | head -1 | sed 's/^x-api-key:[[:space:]]*//')"
  [ -n "$LLAVE" ] && ORIGEN_LLAVE="del dialplan, de una instalación anterior"
fi
if [ -z "$LLAVE" ]; then
  echo "No pude encontrar la API key de la instancia ni en $WEBHOOK ni en $DIALPLAN." >&2
  echo "Sin ella la planta no puede subir nada. Aplique la configuración desde" >&2
  echo "FALCON (Plataforma → Nuestras centralitas) y vuelva a intentarlo." >&2
  exit 1
fi

# ── La URL de FALCON: la que el dialplan ya usa para avisar ──────────────────
URL="$(grep -oE '^[[:space:]]*FALCON_URL[[:space:]]*=[[:space:]]*\S+' "$DIALPLAN" \
        | head -1 | sed 's/.*=[[:space:]]*//' | sed 's#/*$##')"
if [ -z "$URL" ]; then
  echo "No encuentro FALCON_URL en $DIALPLAN." >&2
  exit 1
fi
echo "➤ FALCON: $URL"
echo "➤ API key: la que ya usa esta centralita ($ORIGEN_LLAVE); no se rota"
echo "  (no se imprime: lo que sale por pantalla queda en el historial)"

# ── 1. La credencial para subir ──────────────────────────────────────────────
#
# APARTE de la del webhook, y no es manía: la del webhook fija
# `Content-Type: application/json`, que es lo que el aviso necesita y lo que
# ROMPERÍA una subida multipart —curl tiene que poner el suyo, con el límite—.
cat > "$API" <<EOF
# falcon-api.conf — credencial de esta planta para SUBIR archivos a FALCON.
#
# La escribió activar-grabacion.sh. Es la misma API key del webhook, en un
# archivo aparte y SIN Content-Type: la subida de la grabación es multipart y
# curl tiene que poner el suyo.
header = "x-api-key: $LLAVE"
EOF
chown asterisk:asterisk "$API" 2>/dev/null || true
chmod 600 "$API"
echo "✔ $API"

# Por si quedó de una instalación vieja: el webhook también es secreto.
if [ -f "$WEBHOOK" ]; then
  chown asterisk:asterisk "$WEBHOOK" 2>/dev/null || true
  chmod 600 "$WEBHOOK"
fi

# ── 2. Dónde se graba ────────────────────────────────────────────────────────
install -d -o asterisk -g asterisk -m 750 "$MONITOR" 2>/dev/null \
  || install -d -m 750 "$MONITOR"
echo "✔ $MONITOR"

# ── 3. Comprimir, si se puede ────────────────────────────────────────────────
#
# Un WAV de 8 kHz son ~960 KB por minuto; en MP3 a 24 kbps, ~180 KB. Son los
# mismos bytes que después viajan a FALCON y se guardan en la base del
# municipio. Si no se puede instalar, el script de subida manda el WAV igual.
if [ -n "${FALCON_PRUEBA:-}" ]; then
  echo "➤ (prueba) no se instala lame"
elif ! command -v lame >/dev/null 2>&1; then
  echo "➤ Instalando lame (comprime la grabación 5 veces)"
  apt-get update -qq && apt-get install -y -qq lame || \
    echo "⚠ No se pudo instalar lame: se subirán los WAV sin comprimir."
fi

# ── 4. El script que sube la grabación ───────────────────────────────────────
#
# OJO: esta es la versión para la instalación A MANO. La planta generada por
# FALCON trae la suya (backend/src/pbx/planta/generador.ts), que es la fuente
# de verdad cuando se migre al contenedor. Las dos tienen que cumplir lo
# mismo, y hay una prueba que lo vigila:
#
#   · solo borra el archivo local cuando FALCON confirma;
#   · comprime si puede, y si no sube el WAV;
#   · deja cada fallo escrito con su motivo.
cat > "$SUBIR" <<EOF
#!/usr/bin/env bash
#
# subir-grabacion.sh — lo ejecuta MixMonitor al terminar de grabar.
# Lo escribió activar-grabacion.sh; no lo edite a mano.
#
# Sin «set -e» a propósito: lo que hace falta es que cada fallo quede escrito,
# no que el script muera en el primero.
set -uo pipefail

ID="\${1:-}"
DIR="$MONITOR"
LOG="\${FALCON_LOG:-/var/log/asterisk/falcon-grabaciones.log}"
URL="$URL/api/pbx/grabacion"

anotar() { echo "\$(date '+%Y-%m-%d %H:%M:%S') [\$ID] \$*" >> "\$LOG" 2>/dev/null || true; }

if [ -z "\$ID" ]; then anotar "sin UNIQUEID"; exit 0; fi

WAV="\$DIR/\$ID.wav"
if [ ! -s "\$WAV" ]; then anotar "no existe o está vacío: \$WAV"; exit 0; fi

# Duración aproximada, solo para la descripción: MixMonitor escribe WAV de
# 8 kHz, 16 bits, mono — 16000 bytes por segundo, menos la cabecera.
BYTES="\$(stat -c %s "\$WAV" 2>/dev/null || echo 0)"
SEGUNDOS="\$(( (BYTES > 44 ? BYTES - 44 : 0) / 16000 ))"

SUBIR="\$WAV"
TEMPORAL=""
if command -v lame >/dev/null 2>&1; then
  MP3="\$DIR/\$ID.mp3"
  if lame --quiet -m m -b 24 "\$WAV" "\$MP3" 2>/dev/null && [ -s "\$MP3" ]; then
    SUBIR="\$MP3"; TEMPORAL="\$MP3"
  else
    anotar "lame falló; se sube el WAV"; rm -f "\$MP3"
  fi
fi

CUERPO="\$(mktemp)"
CODIGO="\$(curl -sS -m 300 -o "\$CUERPO" -w '%{http_code}' \\
  -K /etc/asterisk/falcon-api.conf \\
  -F "file=@\$SUBIR" \\
  -F "callId=\$ID" \\
  -F "segundos=\$SEGUNDOS" \\
  "\$URL" 2>>"\$LOG")"

case "\$CODIGO" in
  2*)
    anotar "subida ok (\$CODIGO): \$(head -c 300 "\$CUERPO")"
    # Ahora sí: FALCON la tiene, con su hash y su copia.
    rm -f "\$WAV" "\$TEMPORAL"
    ;;
  *)
    # Se CONSERVA el WAV. Lo que sobra se ve; lo que se borró, no vuelve.
    anotar "no se pudo subir (\$CODIGO): \$(head -c 300 "\$CUERPO")"
    anotar "se conserva \$WAV para reintentar a mano"
    [ -n "\$TEMPORAL" ] && rm -f "\$TEMPORAL"
    ;;
esac
rm -f "\$CUERPO"
EOF
chown asterisk:asterisk "$SUBIR" 2>/dev/null || true
chmod 750 "$SUBIR"
echo "✔ $SUBIR"

# ── 5. La línea del dialplan ─────────────────────────────────────────────────
#
# Una sola, antes del Dial, con respaldo y sin repetirla si ya está. La opción
# `b` graba SOLO cuando la llamada queda establecida: así no quedan cientos de
# archivos de cero segundos de llamadas que nadie contestó. Y el nombre lleva
# el ${UNIQUEID}, que es el identificador que FALCON ya guarda en la llamada:
# es lo que permite adjuntarla al caso sin adivinar.
python3 - "$DIALPLAN" <<'PY'
import re, shutil, sys, time

ruta = sys.argv[1]
texto = open(ruta, encoding='utf-8').read()

import os
MONITOR = os.environ.get('FALCON_MONITOR', '/var/spool/asterisk/monitor')
# Ruta ABSOLUTA, y no un nombre relativo: Asterisk resuelve un relativo contra
# su `astspooldir`, que es configurable. Si alguien lo cambió, el archivo
# aparecería donde el script de subida no lo busca, y la grabación se
# "perdería" sin que nada falle a la vista.
LINEA = (f' same => n,MixMonitor({MONITOR}/${{UNIQUEID}}.wav,b,'
         'bash /etc/asterisk/subir-grabacion.sh ^{UNIQUEID})\n')

if 'subir-grabacion.sh' in texto:
    print('✔ El dialplan ya tiene la grabación; no se toca.')
    raise SystemExit(0)

# El ancla: el Dial del contexto que atiende. Se inserta ANTES, para que la
# grabación empiece con la llamada y no después de que alguien descuelgue.
patron = re.compile(r'^([ \t]*same => n,Dial\(PJSIP/\$\{DESTINO\}.*\n)', re.M)
if not patron.search(texto):
    print('✖ No encontré la línea «same => n,Dial(PJSIP/${DESTINO}…)» en el dialplan.')
    print('  No se tocó nada. Agregue esta línea a mano, justo ANTES de ese Dial:')
    print('   ', LINEA.strip())
    raise SystemExit(1)

respaldo = f'{ruta}.antes-de-grabacion-{time.strftime("%Y%m%d-%H%M%S")}'
shutil.copy2(ruta, respaldo)
open(ruta, 'w', encoding='utf-8').write(patron.sub(LINEA + r'\1', texto, count=1))
print(f'✔ Línea agregada (respaldo en {respaldo})')
PY
AGREGADO=$?
[ "$AGREGADO" -ne 0 ] && exit 1

# ── 6. Recargar SOLO el dialplan ─────────────────────────────────────────────
#
# `dialplan reload` y no `systemctl restart`: lo único que cambió es el plan de
# marcación, y reiniciar tiraría las llamadas en curso.
asterisk -rx 'dialplan reload' >/dev/null 2>&1 && echo "✔ Dialplan recargado"

echo
echo "➤ Comprobación"
if ! command -v asterisk >/dev/null 2>&1; then
  echo "⚠ No encuentro el ejecutable «asterisk», así que no puedo preguntarle"
  echo "  qué cargó. Los archivos SÍ quedaron escritos."
elif asterisk -rx 'dialplan show atender' 2>/dev/null | grep -qi mixmonitor; then
  echo "✔ Asterisk tiene la grabación cargada en el contexto «atender»"
else
  echo "⚠ Asterisk no muestra el MixMonitor en «atender». Si acaba de recargar,"
  echo "  pruebe: sudo asterisk -rx 'dialplan reload' y vuelva a mirar."
fi
echo
echo "Listo. La próxima llamada que se CONTESTE queda grabada y se sube al caso."
echo "Si algo falla, el motivo queda en el registro de la planta"
echo "(/var/log/asterisk/falcon-grabaciones.log) y el archivo se conserva en"
echo "$MONITOR — nunca se borra sin que FALCON confirme que lo recibió."
