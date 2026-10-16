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

# ── El certificado, donde Asterisk lo pueda leer ───────────────────────────
# Let's Encrypt lo deja con permisos de root; Asterisk corre como `asterisk`.
VIVO=/etc/letsencrypt/live/$DOMINIO
if [[ -d $VIVO ]]; then
  install -d -o asterisk -g asterisk -m 750 "$LLAVES"
  install -o asterisk -g asterisk -m 640 "$VIVO/fullchain.pem" "$LLAVES/$DOMINIO.crt"
  install -o asterisk -g asterisk -m 640 "$VIVO/privkey.pem"   "$LLAVES/$DOMINIO.key"
  echo "  ✔ Certificado copiado a $LLAVES"
else
  echo "  ⚠ No encontré $VIVO — el WebSocket NO va a funcionar sin certificado." >&2
  echo "    sudo certbot certonly --standalone -d $DOMINIO" >&2
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

3. FAIL2BAN. Un 5060 expuesto recibe barridos de robo de credenciales a los
   minutos de existir. Si se cuelan, la factura llega a usted:

     sudo apt install -y fail2ban

4. EN FALCON: Plataforma → Planta telefónica → «Asterisk propio», y pegar
     wss://$DOMINIO:8089/ws     y el dominio   $DOMINIO
   La clave SIP de cada operador se registra en Administración → el usuario.

FIN
