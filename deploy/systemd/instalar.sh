#!/usr/bin/env bash
#
# Instala los temporizadores de respaldo de FALCON CAD.
#
#   sudo ./instalar.sh
#
# Se usan temporizadores de systemd y no cron por tres razones concretas, y
# ninguna es de gusto:
#
#   1. Esta imagen de Ubuntu NO TRAE cron. systemd ya está.
#   2. La salida va al diario del sistema sola: ni rutas de log que haya que
#      crear con el dueño correcto, ni rotación que configurar, ni un correo
#      local que nadie lee. `journalctl -u falcon-respaldo` y ya está.
#   3. `Persistent=true` recupera la ejecución perdida. Si el servidor estaba
#      apagado o reiniciándose a las 02:15, cron se salta la noche entera sin
#      que nadie se entere; esto la hace al arrancar.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESTINO=/etc/systemd/system

[[ $EUID -eq 0 ]] || { echo "Hay que correrlo con sudo." >&2; exit 1; }

GUION=/home/ubuntu/falcon-deploy/secad-lite/deploy/respaldo-falcon.sh
[[ -x "$GUION" ]] || {
  echo "✖ No encuentro $GUION (o no es ejecutable)." >&2
  echo "  Las unidades apuntan ahí; si su despliegue está en otra ruta, edítelas antes." >&2
  exit 1
}

for u in falcon-respaldo.service falcon-respaldo.timer \
         falcon-completo.service falcon-completo.timer \
         falcon-verificar.service falcon-verificar.timer; do
  install -m 0644 "$AQUI/$u" "$DESTINO/$u"
  echo "  · $u"
done

systemctl daemon-reload
systemctl enable --now falcon-respaldo.timer falcon-completo.timer falcon-verificar.timer

echo
echo "Listo. Lo que corre y cuándo:"
systemctl list-timers 'falcon-*' --no-pager
echo
echo "Para ver cómo terminó el último respaldo:"
echo "  journalctl -u falcon-respaldo -n 40 --no-pager"
