#!/usr/bin/env bash
#
# Pone el certificado de Let's Encrypt donde coturn pueda leerlo, y lo reinicia.
#
# Se ejecuta solo, como gancho de renovación de certbot. Instalarlo con:
#
#   sudo install -m 755 coturn-certificado.sh /etc/letsencrypt/renewal-hooks/deploy/coturn
#
# Por qué copiar en vez de apuntar a /etc/letsencrypt/live:
#
#   Ese directorio es 0700 de root, y coturn corre como el usuario `turnserver`.
#   Apuntar ahí directamente deja a coturn sin poder leer la clave y el servicio
#   no arranca. La salida típica es «CONFIG ERROR: cannot read private key file»
#   — y como el TURN solo hace falta en redes con NAT cerrado, el síntoma que se
#   ve es «a veces la videollamada no conecta», no un servicio caído.
#
#   La alternativa —aflojar los permisos de /etc/letsencrypt— se los afloja a
#   TODOS los certificados del servidor. Copiar solo este es más barato.
#
# Y por qué reiniciar: coturn lee los certificados al arrancar y no los vuelve
# a mirar. Sin esto, a los 60 días sigue presentando el certificado vencido.
set -euo pipefail

DOMINIO="${COTURN_DOMINIO:-turn.falconcad.com.co}"
ORIGEN="/etc/letsencrypt/live/$DOMINIO"
DESTINO="/etc/coturn/certs"

[[ -r "$ORIGEN/fullchain.pem" ]] || { echo "No está $ORIGEN/fullchain.pem" >&2; exit 1; }

# `turnserver` es el usuario del paquete de Debian/Ubuntu. Si este servidor
# corre coturn como root, el chown falla y es mejor saberlo que seguir a ciegas.
USUARIO="${COTURN_USUARIO:-turnserver}"
id -u "$USUARIO" >/dev/null 2>&1 || { echo "No existe el usuario $USUARIO" >&2; exit 1; }

install -d -m 0750 -o root -g "$USUARIO" "$DESTINO"
install -m 0644 -o root -g "$USUARIO" "$ORIGEN/fullchain.pem" "$DESTINO/fullchain.pem"
install -m 0640 -o root -g "$USUARIO" "$ORIGEN/privkey.pem"   "$DESTINO/privkey.pem"

# Reiniciar corta los relevos en curso. Es inevitable —coturn no recarga
# certificados— y pasa una vez cada dos meses, pero conviene saberlo: si cae
# justo sobre una videollamada activa, esa llamada pierde el relevo.
systemctl restart coturn
echo "Certificado de $DOMINIO instalado en $DESTINO y coturn reiniciado."
