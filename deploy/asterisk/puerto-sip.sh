#!/usr/bin/env bash
#
# Cambia el puerto por el que Asterisk escucha SIP, y abre ese puerto en el
# cortafuegos del servidor.
#
#   sudo ./puerto-sip.sh 3478
#   sudo ./puerto-sip.sh 5060      # para volver al de siempre
#
# ───────────────────────────────────────────────────────────────────────────
# POR QUÉ EXISTE ESTO
#
# Porque pedirle a alguien «borre el bloque [transport-udp] de pjsip.conf y
# ponga un #include» es pedirle que edite a mano un archivo de configuración
# con la centralita en producción, y eso se hace mal una de cada tres veces.
# El cambio real es UNA línea; esto la cambia, respalda lo anterior y
# comprueba que quedó.
#
# Hace falta cuando el puerto 5060 está cerrado en el cortafuegos de la nube y
# no se puede abrir — ver `docs/telefonia-asterisk-propio.md` §6.6. El puerto
# que se elija aquí hay que ponerlo TAMBIÉN en el panel del proveedor, en el
# campo de puerto del host de destino.
# ───────────────────────────────────────────────────────────────────────────
set -euo pipefail

PUERTO="${1:-}"
CONF=/etc/asterisk/pjsip.conf

[[ $EUID -eq 0 ]] || { echo "Córralo con sudo." >&2; exit 1; }
[[ $PUERTO =~ ^[0-9]+$ ]] && (( PUERTO > 0 && PUERTO < 65536 )) \
  || { echo "Uso: sudo $0 <puerto>   (ej. 3478)" >&2; exit 1; }
[[ -f $CONF ]] || { echo "No existe $CONF." >&2; exit 1; }

actual=$(grep -oP '^bind = 0\.0\.0\.0:\K[0-9]+' "$CONF" | head -1 || true)
[[ -n $actual ]] || {
  echo "No encontré la línea 'bind = 0.0.0.0:<puerto>' en $CONF." >&2
  echo "Revísela a mano: el bloque [transport-udp] debe tener una." >&2
  exit 1
}

if [[ $actual == "$PUERTO" ]]; then
  echo "Ya estaba en $PUERTO; no hay nada que cambiar."
else
  # Quién tiene ese puerto AHORA. Asterisk no avisa bien de un choque: se
  # queda sin transporte UDP y las llamadas simplemente no entran.
  otro=$(ss -ulnpH "sport = :$PUERTO" 2>/dev/null | grep -v '"asterisk"' || true)
  if [[ -n $otro ]]; then
    echo "  ✖ El puerto $PUERTO lo tiene otro proceso:" >&2
    sed 's/^/      /' <<<"$otro" >&2
    echo "    Párelo primero, o elija otro puerto." >&2
    exit 1
  fi

  cp -a "$CONF" "$CONF.respaldo-$(date +%Y%m%d-%H%M%S)"
  sed -i "s|^bind = 0\.0\.0\.0:$actual\$|bind = 0.0.0.0:$PUERTO|" "$CONF"
  echo "  ✔ $CONF: $actual → $PUERTO  (respaldo al lado)"
fi

# El cortafuegos del servidor. El de la nube es otro y no se toca desde aquí.
if ! iptables -C INPUT -p udp --dport "$PUERTO" -j ACCEPT 2>/dev/null; then
  iptables -I INPUT -p udp --dport "$PUERTO" -j ACCEPT
  echo "  ✔ iptables: abierto $PUERTO/udp"
fi
if ! iptables -C INPUT -p udp --dport 10000:20000 -j ACCEPT 2>/dev/null; then
  iptables -I INPUT -p udp --dport 10000:20000 -j ACCEPT
  echo "  ✔ iptables: abierto 10000-20000/udp (audio)"
fi
netfilter-persistent save >/dev/null 2>&1 && echo "  ✔ reglas guardadas" \
  || echo "  ⚠ No pude guardar las reglas; se pierden al reiniciar (apt install iptables-persistent)"

systemctl restart asterisk
sleep 2

echo
asterisk -rx "pjsip show transports"
echo
echo "Ahora ponga el puerto $PUERTO en el panel del proveedor,"
echo "en el campo de puerto del host de destino."
