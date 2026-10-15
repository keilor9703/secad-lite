#!/usr/bin/env bash
#
# Prueba de cómo se INVOCA deploy/deploy-falcon.sh.
#
#   ./deploy/pruebas/lanzador.prueba.sh
#
# Por qué existe esta prueba y no es paranoia:
#
# El manual decía, desde el primer día, `cp secad-lite/deploy/deploy-falcon.sh .`.
# Esa copia quedó congelada en el día en que se hizo y es la que se ejecuta
# todas las mañanas. Resultado: cada arreglo del script viajaba hasta el
# servidor con `git pull` y NUNCA llegaba a ejecutarse — el mismo error de
# publicación volvió tres veces después de estar corregido en el repositorio,
# y cada vez costó un despliegue y la confianza en que el arreglo servía.
#
# Y el guardián que debía atrapar eso tenía su propio fallo: resolvía
# `BASH_SOURCE` DESPUÉS de hacer `cd` al repositorio, así que al enlace
# simbólico —la forma correcta de instalarlo— lo rechazaba igual que a una
# copia. Se descubrió probándolo, no leyéndolo.
#
# Así que aquí se ejercita el arranque de verdad, con un árbol de despliegue
# falso: un git de mentira con su origin, un docker-compose vacío y un .env.
# Todo lo que viene después (docker, npm) no se toca: la prueba termina en el
# momento en que el script pasa —o no— los guardianes.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
GUION="$RAIZ/deploy/deploy-falcon.sh"
BASE_TMP="${TMPDIR:-/var/tmp}/falcon-prueba-lanzador.$$"

ok=0; mal=0
afirmar_que() {
  if [[ "$2" == 1 ]]; then printf '  ✔ %s\n' "$1"; ok=$((ok + 1))
  else printf '  ✖ %s\n' "$1"; mal=$((mal + 1)); fi
}

limpiar() { rm -rf "$BASE_TMP"; }
trap limpiar EXIT

# ── Árbol de despliegue falso ────────────────────────────────────────────
# Con un origin real: el script hace `git fetch` y `merge --ff-only`, y sin
# remoto no llegaría ni al primer guardián.
mkdir -p "$BASE_TMP"/{origen,casa/falcon-deploy}
git init -q --bare "$BASE_TMP/origen/repo.git"

git clone -q "$BASE_TMP/origen/repo.git" "$BASE_TMP/trabajo"
mkdir -p "$BASE_TMP/trabajo/deploy"
cp "$GUION" "$BASE_TMP/trabajo/deploy/deploy-falcon.sh"
git -C "$BASE_TMP/trabajo" add -A
git -C "$BASE_TMP/trabajo" -c user.email=p@p -c user.name=prueba commit -qm "script"
git -C "$BASE_TMP/trabajo" push -q origin HEAD:main 2>/dev/null

CASA="$BASE_TMP/casa"
DESPLIEGUE="$CASA/falcon-deploy"
git clone -q "$BASE_TMP/origen/repo.git" "$DESPLIEGUE/secad-lite" 2>/dev/null
git -C "$DESPLIEGUE/secad-lite" checkout -q -B main origin/main
touch "$DESPLIEGUE/docker-compose.yml"
printf 'DOMAIN=falconcad.local\n' > "$DESPLIEGUE/.env"

# Corre el script como lo correría el servidor y devuelve TODA su salida. El
# código de salida no sirve de veredicto: pasados los guardianes, el script
# muere en docker, que aquí no existe — y eso es exactamente lo que se espera.
correr() { ( cd "$DESPLIEGUE" && HOME="$CASA" bash "$1" frontend 2>&1 ) || true; }

echo "==> Árbol de despliegue falso en $BASE_TMP"

# ── Una copia, que es lo que había en producción ─────────────────────────
echo
echo "==> Invocado como copia (lo que decía el manual)"
cp "$DESPLIEGUE/secad-lite/deploy/deploy-falcon.sh" "$DESPLIEGUE/deploy-falcon.sh"
salida=$(correr ./deploy-falcon.sh)

afirmar_que "se niega a correr desde una copia" \
  "$(echo "$salida" | grep -q 'COPIA del script' && echo 1 || echo 0)"
afirmar_que "dice CÓMO arreglarlo, no solo que está mal" \
  "$(echo "$salida" | grep -q 'ln -s secad-lite/deploy/deploy-falcon.sh' && echo 1 || echo 0)"
afirmar_que "y no llega a tocar nada: se detiene antes de compilar" \
  "$(echo "$salida" | grep -q 'Compilando el frontend' && echo 0 || echo 1)"

# ── Un enlace, que es la forma correcta ──────────────────────────────────
echo
echo "==> Invocado como enlace simbólico (la forma correcta)"
rm "$DESPLIEGUE/deploy-falcon.sh"
ln -s secad-lite/deploy/deploy-falcon.sh "$DESPLIEGUE/deploy-falcon.sh"
salida=$(correr ./deploy-falcon.sh)

# Este es el caso que el guardián roto rechazaba. Si vuelve a romperse, el
# despliegue de todos los días deja de funcionar con un mensaje desconcertante.
afirmar_que "el enlace NO se confunde con una copia" \
  "$(echo "$salida" | grep -q 'COPIA del script' && echo 0 || echo 1)"
afirmar_que "pasa los guardianes y llega a compilar" \
  "$(echo "$salida" | grep -q 'Compilando el frontend' && echo 1 || echo 0)"

# ── Invocado por su ruta en el repositorio ───────────────────────────────
echo
echo "==> Invocado por la ruta del repositorio"
salida=$(correr ./secad-lite/deploy/deploy-falcon.sh)
afirmar_que "también vale llamarlo por su ruta" \
  "$(echo "$salida" | grep -q 'Compilando el frontend' && echo 1 || echo 0)"

# ── El script cambia en el merge: tiene que relanzarse ───────────────────
echo
echo "==> El merge trae una versión nueva del propio script"
# Se marca la versión del repositorio de forma visible y se publica.
sed -i '2i # marca-de-prueba-relanzamiento' "$BASE_TMP/trabajo/deploy/deploy-falcon.sh"
git -C "$BASE_TMP/trabajo" add -A
git -C "$BASE_TMP/trabajo" -c user.email=p@p -c user.name=prueba commit -qm "cambio del script"
git -C "$BASE_TMP/trabajo" push -q origin HEAD:main 2>/dev/null
# El checkout del despliegue se queda atrás a propósito: así el merge del
# script trae el cambio en la misma corrida, que es el caso real.
git -C "$DESPLIEGUE/secad-lite" reset -q --hard HEAD~0

salida=$(correr ./deploy-falcon.sh)
afirmar_que "se relanza con la versión nueva en vez de seguir con la vieja" \
  "$(echo "$salida" | grep -q 'relanzando con la versión nueva' && echo 1 || echo 0)"
afirmar_que "y no se queda en bucle: compila una sola vez" \
  "$(test "$(echo "$salida" | grep -c 'Compilando el frontend')" -le 1 && echo 1 || echo 0)"

# ── Sin .env no puede morir en silencio ──────────────────────────────────
echo
echo "==> Sin .env (el DOMAIN sale de ahí)"
mv "$DESPLIEGUE/.env" "$DESPLIEGUE/.env.guardado"
salida=$(correr ./deploy-falcon.sh)
# `grep` sobre un archivo que no existe sale con 2, y con `set -e` eso mataba
# el script ANTES de imprimir una sola línea: código 2 y pantalla en blanco.
afirmar_que "dice algo en vez de morir callado" \
  "$(test -n "$salida" && echo 1 || echo 0)"
afirmar_que "y llega igual a compilar: el dominio no es imprescindible" \
  "$(echo "$salida" | grep -q 'Compilando el frontend' && echo 1 || echo 0)"
mv "$DESPLIEGUE/.env.guardado" "$DESPLIEGUE/.env"

echo
echo "────────────────────────────────────────"
echo "$ok comprobaciones bien, $mal mal"
[[ "$mal" == 0 ]]
