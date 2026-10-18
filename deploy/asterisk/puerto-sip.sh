#!/usr/bin/env bash
#
# Cambia el puerto por el que Asterisk escucha SIP (el transporte UDP), y abre
# ese puerto en el cortafuegos del servidor.
#
#   sudo ./puerto-sip.sh 3478
#   sudo ./puerto-sip.sh 5060      # para volver al de siempre
#
# ───────────────────────────────────────────────────────────────────────────
# POR QUÉ ESTO MIRA LA SECCIÓN Y NO LA PRIMERA LÍNEA QUE ENCUENTRA
#
# La primera versión hacía `grep '^bind = 0.0.0.0:' | head -1` y cambiaba esa.
# En la plantilla el bloque [transport-wss] va ANTES que el [transport-udp],
# así que en el primer uso real movió el WebSocket de la barra del 8089 al
# 3478 y dejó el SIP intacto en el 5060 — lo contrario de lo que se le pidió,
# y anunciando «hecho». Dos servicios rotos de un golpe.
#
# Por eso ahora recorre el archivo por secciones y toca ÚNICAMENTE el `bind`
# que está dentro de [transport-udp]. Y al final comprueba que el WSS siguió
# donde estaba, porque un script que puede romper algo tiene que mirar si lo
# rompió.
# ───────────────────────────────────────────────────────────────────────────
set -euo pipefail

PUERTO="${1:-}"
CONF=/etc/asterisk/pjsip.conf

[[ $EUID -eq 0 ]] || { echo "Córralo con sudo." >&2; exit 1; }
[[ $PUERTO =~ ^[0-9]+$ ]] && (( PUERTO > 0 && PUERTO < 65536 )) \
  || { echo "Uso: sudo $0 <puerto>   (ej. 3478)" >&2; exit 1; }
[[ -f $CONF ]] || { echo "No existe $CONF." >&2; exit 1; }

# Quién tiene ese puerto AHORA. Asterisk no avisa bien de un choque: se queda
# sin transporte y las llamadas simplemente no entran.
otro=$(ss -ulnpH "sport = :$PUERTO" 2>/dev/null | grep -v '"asterisk"' || true)
if [[ -n $otro ]]; then
  echo "  ✖ El puerto $PUERTO/udp lo tiene otro proceso:" >&2
  sed 's/^/      /' <<<"$otro" >&2
  echo "    Párelo primero, o elija otro puerto." >&2
  exit 1
fi

cp -a "$CONF" "$CONF.respaldo-$(date +%Y%m%d-%H%M%S)"

python3 - "$CONF" "$PUERTO" <<'PY'
import re, sys
ruta, puerto = sys.argv[1], sys.argv[2]
lineas = open(ruta, encoding='utf-8').read().splitlines(keepends=True)

seccion, cambiadas, antes = None, 0, None
for i, linea in enumerate(lineas):
    s = re.match(r'\s*\[([^\]]+)\]', linea)
    if s:
        seccion = s.group(1)
        continue
    # Solo el bind de [transport-udp]. El de [transport-wss] no se toca.
    if seccion == 'transport-udp':
        b = re.match(r'(\s*bind\s*=\s*)([0-9.]+):(\d+)(\s*)$', linea)
        if b:
            antes = b.group(3)
            lineas[i] = f'{b.group(1)}{b.group(2)}:{puerto}{b.group(4)}'
            cambiadas += 1

if cambiadas == 0:
    sys.exit("No encontré un 'bind' dentro de [transport-udp]. Revise el archivo a mano.")
open(ruta, 'w', encoding='utf-8').write(''.join(lineas))
print(f'  ✔ [transport-udp] bind: {antes} → {puerto}  (respaldo al lado)')
PY

for regla in "--dport $PUERTO" "--dport 10000:20000"; do
  # shellcheck disable=SC2086
  if ! iptables -C INPUT -p udp $regla -j ACCEPT >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    iptables -I INPUT -p udp $regla -j ACCEPT
    echo "  ✔ iptables: abierto udp $regla"
  fi
done
netfilter-persistent save >/dev/null 2>&1 && echo "  ✔ reglas guardadas" \
  || echo "  ⚠ No pude guardar las reglas; se pierden al reiniciar (apt install iptables-persistent)"

systemctl restart asterisk
sleep 2

echo
asterisk -rx "pjsip show transports"

# Comprobar que quedó lo que se pidió Y que no se movió lo que no se pidió.
estado=$(asterisk -rx "pjsip show transports")
ok=0
grep -qE "transport-udp +udp .*0\.0\.0\.0:$PUERTO" <<<"$estado" \
  && echo "  ✔ SIP en el $PUERTO" || { echo "  ✖ El SIP NO quedó en el $PUERTO" >&2; ok=1; }
grep -qE "transport-wss +wss .*0\.0\.0\.0:8089" <<<"$estado" \
  && echo "  ✔ WebSocket intacto en el 8089" \
  || echo "  ⚠ El WebSocket NO está en el 8089 — revíselo, la barra no se registrará" >&2

echo
echo "Ponga el puerto $PUERTO en el panel del proveedor, en el campo de"
echo "puerto del host de destino."
exit $ok
