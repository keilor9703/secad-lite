#!/usr/bin/env bash
#
# Deja Asterisk listo para FALCON CAD: rellena las plantillas de esta carpeta
# y las instala en /etc/asterisk.
#
#   sudo ./instalar.sh
#
# NO instala Asterisk ni pide el certificado: eso va antes, y a propósito —
# son los dos pasos donde algo puede salir mal de forma que convenga ver.
#
#   sudo apt install -y asterisk certbot
#   sudo certbot certonly --standalone -d centralita.sudominio.com
#
# Lo que hace este script sí es repetitivo y fácil de equivocar a mano: los
# mismos cinco valores aparecen en cuatro archivos, y un dominio escrito
# distinto en dos sitios da un error que no se parece en nada a su causa.
#
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESTINO=/etc/asterisk
LLAVES=$DESTINO/keys

[[ $EUID -eq 0 ]] || { echo "Córralo con sudo." >&2; exit 1; }
[[ -d $DESTINO ]] || { echo "No existe $DESTINO. ¿Instaló Asterisk?" >&2; exit 1; }

echo "── Datos de la centralita ──────────────────────────────────────────"
read -rp "Dominio de la centralita (ej. centralita.sudominio.com): " DOMINIO
read -rp "IP pública del servidor: " IP_PUBLICA
read -rp "URL de FALCON (ej. https://falcon-test.falconcad.com.co): " FALCON_URL
# Sin esquema, `curl` asume http:// y el servidor redirige a https; como el
# dialplan llama con -s y sin -L, la redirección no se sigue y EL WEBHOOK
# NUNCA LLEGA, en silencio. Pasó en la primera instalación real.
case "$FALCON_URL" in
  https://*) ;;
  http://*)  echo "  ⚠ http:// — el webhook viaja sin cifrar y suele redirigir. Use https://." ;;
  *)         FALCON_URL="https://$FALCON_URL"
             echo "  → Sin esquema; se usa $FALCON_URL" ;;
esac
FALCON_URL="${FALCON_URL%/}"   # sin barra final: el dialplan ya la pone

# La API key y las claves se leen SIN ECO y no se imprimen nunca: quedan en
# /etc/asterisk, que es donde deben estar, y no en el historial del shell.
read -rsp "API key de la instancia de FALCON: " FALCON_KEY; echo
read -rsp "Clave de la extensión 101: " CLAVE_101; echo
read -rsp "Clave para el usuario ARI 'falcon': " CLAVE_ARI; echo

echo
echo "── Troncal (deje vacío si todavía no la tiene) ─────────────────────"
read -rp "Servidor SIP del operador: " SERVIDOR_TRONCAL
read -rp "Usuario SIP: " USUARIO_TRONCAL
read -rsp "Clave SIP: " CLAVE_TRONCAL; echo
read -rp "IP del proveedor (para abrir el 5060 solo a ella): " IP_PROVEEDOR

# ── ¿Están libres los puertos? ─────────────────────────────────────────────
# Asterisk no avisa bien de esto: si no puede abrir su puerto HTTP, responde
# «Server Disabled» y se cae TAMBIÉN el 8089, que es el que importa. El
# mensaje no menciona el puerto ocupado por ningún lado. Pasó en la primera
# instalación real, con el 8088 tomado por un contenedor.
echo
echo "── Puertos ─────────────────────────────────────────────────────────"
for p in 8089 8090; do
  quien=$(ss -tulnpH "sport = :$p" 2>/dev/null || true)
  if [[ -z $quien ]]; then
    echo "  ✔ $p libre"
  elif grep -q '"asterisk"' <<<"$quien"; then
    # Es el propio Asterisk, de una instalación anterior. No es un conflicto:
    # lo suelta al recargar. Sin esta rama, el script se bloqueaba a sí mismo
    # en la segunda corrida — que es justo cuando más falta hace.
    echo "  ✔ $p lo tiene el propio Asterisk; lo suelta al recargar"
  else
    echo "  ✖ El puerto $p está OCUPADO por otro proceso:" >&2
    sed 's/^/      /' <<<"$quien" >&2
    echo "    Cambie el puerto en http.conf.plantilla y vuelva a correr esto." >&2
    exit 1
  fi
done

# ── El certificado, donde Asterisk lo pueda leer ───────────────────────────
# Let's Encrypt lo deja con permisos de root; Asterisk corre como `asterisk`.
VIVO=/etc/letsencrypt/live/$DOMINIO
if [[ -d $VIVO ]]; then
  install -d -o asterisk -g asterisk -m 750 "$LLAVES"
  install -o asterisk -g asterisk -m 640 "$VIVO/fullchain.pem" "$LLAVES/$DOMINIO.crt"
  install -o asterisk -g asterisk -m 640 "$VIVO/privkey.pem"   "$LLAVES/$DOMINIO.key"
  echo "  ✔ Certificado copiado a $LLAVES"
else
  echo >&2
  echo "  ✖ No encontré $VIVO." >&2
  echo "    Sin certificado, Asterisk no abre el 8089 y la barra NO se registra." >&2
  echo "    No tiene sentido seguir: pida el certificado y vuelva a correr esto." >&2
  echo >&2
  echo "    Si el 80 está ocupado por un nginx EN DOCKER, pararlo con" >&2
  echo "    'systemctl stop nginx' no sirve — el puerto lo tiene docker-proxy:" >&2
  echo >&2
  echo "      docker stop \$(docker ps --filter publish=80 -q)" >&2
  echo "      sudo certbot certonly --standalone -d $DOMINIO" >&2
  echo "      docker start \$(docker ps -a --filter publish=80 -q)" >&2
  echo >&2
  exit 1
fi

# ── Rellenar las plantillas ────────────────────────────────────────────────
# Se respalda lo que haya antes de pisarlo: un Asterisk que ya estaba
# atendiendo no se sobrescribe sin dejar cómo volver.
SELLO=$(date +%Y%m%d-%H%M%S)
rellenar() {
  local plantilla="$AQUI/$1.plantilla" final="$DESTINO/$1"
  [[ -f $final ]] && cp -a "$final" "$final.respaldo-$SELLO"
  sed -e "s|DOMINIO_CENTRALITA|$DOMINIO|g" \
      -e "s|IP_PUBLICA|$IP_PUBLICA|g" \
      -e "s|URL_DE_FALCON|$FALCON_URL|g" \
      -e "s|API_KEY_DE_LA_INSTANCIA|$FALCON_KEY|g" \
      -e "s|CLAVE_DE_LA_101|$CLAVE_101|g" \
      -e "s|CLAVE_ARI|$CLAVE_ARI|g" \
      -e "s|SERVIDOR_TRONCAL|$SERVIDOR_TRONCAL|g" \
      -e "s|USUARIO_TRONCAL|$USUARIO_TRONCAL|g" \
      -e "s|CLAVE_TRONCAL|$CLAVE_TRONCAL|g" \
      -e "s|IP_DEL_PROVEEDOR|$IP_PROVEEDOR|g" \
      "$plantilla" > "$final"
  # Estos archivos llevan claves en claro: nadie más que Asterisk los lee.
  chown asterisk:asterisk "$final"
  chmod 640 "$final"
  echo "  ✔ $final"
}

echo
echo "── Instalando ──────────────────────────────────────────────────────"
for f in pjsip.conf extensions.conf http.conf ari.conf; do rellenar "$f"; done

# La troncal SOLO si se dieron los datos. Un bloque con los campos vacíos no
# es «una troncal apagada»: deja un `match =` sin nada en el type=identify,
# que es la regla que decide quién puede entregar llamadas por el 5060.
# Vacía, no protege nada. `pjsip.conf` lo incluye siempre, así que el archivo
# tiene que existir — vacío si no hay troncal.
if [[ -n $SERVIDOR_TRONCAL && -n $USUARIO_TRONCAL && -n $IP_PROVEEDOR ]]; then
  rellenar pjsip-troncal.conf
else
  echo "; Sin troncal todavía. Entre extensiones se prueba igual." > "$DESTINO/pjsip-troncal.conf"
  chown asterisk:asterisk "$DESTINO/pjsip-troncal.conf"; chmod 640 "$DESTINO/pjsip-troncal.conf"
  echo "  ○ $DESTINO/pjsip-troncal.conf (vacío: faltan datos del operador)"
fi

# ── Apagar chan_sip, el driver viejo ──────────────────────────────────────
# Asterisk 18 todavía trae `chan_sip`, y el paquete de Debian lo carga. Las
# dos pilas —chan_sip y res_pjsip— compiten por el subprotocolo `sip` del
# WebSocket, y **gana la que cargue primero**.
#
# Cuando gana chan_sip, el síntoma no se parece en nada a la causa: el
# WebSocket conecta («101 Switching Protocols»), el navegador manda su
# REGISTER, recibe el desafío 401 y luego un **403 Forbidden** — porque
# chan_sip no conoce la extensión, que vive en pjsip.conf. Se puede pasar una
# tarde revisando la clave SIP, que está bien.
#
# La pista para reconocerlo en un trazado: chan_sip pone etiquetas que
# empiezan por «as» (`;tag=as4b4f731e`) y anuncia `Supported: replaces,
# timer`; PJSIP anuncia `Supported: 100rel, timer, replaces, norefersub`.
if ! grep -qE '^\s*noload\s*=>\s*chan_sip\.so' "$DESTINO/modules.conf" 2>/dev/null; then
  [[ -f $DESTINO/modules.conf ]] && cp -a "$DESTINO/modules.conf" "$DESTINO/modules.conf.respaldo-$SELLO"
  printf '\n; Apagado por FALCON: compite con res_pjsip por el WebSocket.\nnoload => chan_sip.so\n' \
    >> "$DESTINO/modules.conf"
  echo "  ✔ chan_sip apagado en modules.conf"
fi

echo
echo "── Recargando ──────────────────────────────────────────────────────"
systemctl reload asterisk 2>/dev/null || systemctl restart asterisk
sleep 2

echo
echo "── Comprobaciones ──────────────────────────────────────────────────"
asterisk -rx "pjsip show endpoints"      | head -20 || true
asterisk -rx "pjsip show registrations"  | head -10 || true
asterisk -rx "http show status"          | head -12 || true

cat <<FIN

── Falta por fuera de este script ────────────────────────────────────────

1. LOS DOS CORTAFUEGOS. Abrir el puerto en la consola de OCI y no en
   iptables es la causa número uno de «configuré todo y no conecta»:

     sudo iptables -I INPUT -p tcp --dport 8089 -j ACCEPT
     sudo iptables -I INPUT -p udp --dport 10000:20000 -j ACCEPT
     sudo iptables -I INPUT -p udp --dport 5060 -s $IP_PROVEEDOR -j ACCEPT
     sudo netfilter-persistent save

2. EL DNS EN GRIS. Si $DOMINIO está en Cloudflare con la nube naranja, el
   WebSocket no conecta y no hay mensaje que lo explique.

3. FAIL2BAN con el jail de Asterisk activado. Un 5060 expuesto recibe
   barridos de robo de credenciales a los minutos de existir; si se cuelan,
   la factura llega a usted.

4. EN FALCON: Plataforma → Planta telefónica → «Asterisk propio», y pegar
     wss://$DOMINIO:8089/ws     y el dominio   $DOMINIO
   La clave SIP de cada operador se registra en Administración → el usuario.

FIN
