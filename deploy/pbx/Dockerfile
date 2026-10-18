# ─────────────────────────────────────────────────────────────────────────────
# LA IMAGEN DE LAS PLANTAS DE FALCON
#
# Una sola imagen para TODOS los municipios: lo que cambia entre plantas es la
# configuración, que FALCON genera y se monta en /etc/asterisk. Si la imagen
# fuera por municipio, actualizar Asterisk sería un trabajo por municipio.
#
# Se construye una vez por servidor:
#
#   docker build -t falcon-pbx:1 /opt/falcon-pbx/imagen
#
# POR QUÉ EL ASTERISK DE DEBIAN Y NO UNA IMAGEN DE TERCEROS: porque es el que
# está probado en nuestra instalación a mano, con una llamada real de punta a
# punta, y porque una imagen de Docker Hub puede desaparecer o cambiar de
# etiqueta sin avisar. Aquí la versión la fija Debian y el repositorio es el
# mismo que usamos en el servidor.
#
# NO SE INSTALAN LAS LOCUCIONES: el dialplan no reproduce ninguna. El ciudadano
# en espera oye TIMBRE, no música ni «su llamada es importante para nosotros»,
# porque el timbre es lo que le dice que su llamada está viva. Eso ahorra unos
# 40 MB y una decisión de idioma por municipio.
# ─────────────────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

# `curl` no es un extra: es como el dialplan le avisa a FALCON de cada llamada.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      asterisk \
      curl \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Las grabaciones y los registros salen por volúmenes; la configuración entra
# por volumen. La imagen no guarda nada propio de ningún municipio.
VOLUME ["/etc/asterisk", "/var/spool/asterisk/monitor", "/var/log/asterisk"]

# En primer plano, para que Docker lo supervise y `restart: unless-stopped`
# funcione. Como root dentro de SU contenedor: así los archivos con claves
# pueden quedar en 600 sin que el proceso se quede sin poder leerlos, que es
# una forma especialmente confusa de no arrancar.
CMD ["asterisk", "-f", "-vvv"]
