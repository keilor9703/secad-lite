#!/usr/bin/env bash
#
# Despliegue de Falcon CAD en PRODUCCIÓN.
#
#   cd ~/falcon-deploy && ./deploy-falcon.sh
#
# Opciones:
#   --sin-respaldo   No respalda la base antes de desplegar (no recomendado).
#   --solo-frontend  Compila y publica el frontend; no toca backend ni base.
#   --solo-backend   Reconstruye el backend; no toca el frontend.
#
# Qué hace distinto al de desarrollo, y por qué:
#
#   1. RESPALDA ANTES. Un despliegue puede traer migraciones, y las migraciones
#      se aplican solas al arrancar. Si una sale mal sobre datos reales, el
#      respaldo de hace cinco minutos es la diferencia entre un susto y una
#      pérdida.
#   2. REINICIA LAS RÉPLICAS DE UNA EN UNA. Con las tres a la vez el sitio
#      queda caído mientras arrancan. De a una, siempre hay alguien atendiendo.
#   3. PUBLICA EL FRONTEND DE GOLPE. Se compila aparte y se cambia al final;
#      así nadie carga una página a medio copiar.
#   4. SE DETIENE ANTE EL PRIMER ERROR y lo dice. No sigue adelante dejando
#      medio desplegado.
set -euo pipefail

cd "$(dirname "$0")"

# ── Comprobaciones previas ───────────────────────────────────────────────
[[ -f docker-compose.yml ]] || { echo "✖ No veo docker-compose.yml. ¿Está en ~/falcon-deploy?"; exit 1; }
[[ -f .env ]]               || { echo "✖ Falta .env."; exit 1; }
[[ -d secad-lite ]]         || { echo "✖ Falta el clon del repositorio (secad-lite/)."; exit 1; }

RESPALDAR=1; FRONTEND=1; BACKEND=1
for arg in "$@"; do
  case "$arg" in
    --sin-respaldo)  RESPALDAR=0 ;;
    --solo-frontend) BACKEND=0; RESPALDAR=0 ;;
    --solo-backend)  FRONTEND=0 ;;
    *) echo "✖ Opción desconocida: $arg"; exit 1 ;;
  esac
done

DOMINIO=$(grep -E '^DOMAIN=' .env | cut -d= -f2-)
DOMINIO=${DOMINIO:-falconcad.com.co}
SALUD="https://${DOMINIO}/api/health"

paso() { echo; echo "── $* ──"; }

# ── 1. Respaldo ──────────────────────────────────────────────────────────
if [[ $RESPALDAR -eq 1 ]]; then
  paso "Respaldando la base antes de tocar nada"

  # /opt pertenece a root: si no se preparó antes con sudo, no se calla el
  # fallo ni se sigue sin respaldo — se guarda en el home, que siempre se
  # puede escribir, y se dice dónde quedó.
  DIR_RESPALDOS="${FALCON_RESPALDOS:-/opt/falcon-backups}"
  if ! mkdir -p "$DIR_RESPALDOS" 2>/dev/null || [[ ! -w "$DIR_RESPALDOS" ]]; then
    DIR_RESPALDOS="$HOME/falcon-backups"
    mkdir -p "$DIR_RESPALDOS"
    echo "   (sin permiso de escritura en /opt/falcon-backups; se usa $DIR_RESPALDOS)"
  fi

  COPIA="$DIR_RESPALDOS/predespliegue-$(date +%F-%H%M%S).dump"
  docker compose exec -T postgres pg_dump -U falcon -d falcon_cad -Fc > "$COPIA"

  # Un respaldo vacío es peor que ninguno: da la sensación de estar cubierto.
  BYTES=$(stat -c%s "$COPIA" 2>/dev/null || echo 0)
  if [[ "$BYTES" -lt 10000 ]]; then
    echo "✖ El respaldo salió vacío o truncado ($BYTES bytes). No se sigue."
    rm -f "$COPIA"
    exit 1
  fi
  echo "   $COPIA  ($(du -h "$COPIA" | cut -f1))"
fi

# ── 2. Código ────────────────────────────────────────────────────────────
paso "Trayendo el código"
ANTES=$(git -C secad-lite rev-parse HEAD)
git -C secad-lite pull --ff-only
DESPUES=$(git -C secad-lite rev-parse HEAD)

if [[ "$ANTES" == "$DESPUES" ]]; then
  echo "   Sin cambios nuevos (ya estaba en $(git -C secad-lite rev-parse --short HEAD))."
else
  echo "   Entra:"
  git -C secad-lite log --oneline "$ANTES..$DESPUES" | sed 's/^/     /'
fi

# ── 3. Backend, réplica por réplica ──────────────────────────────────────
if [[ $BACKEND -eq 1 ]]; then
  paso "Construyendo la imagen del backend"
  docker compose build backend1

  # backend1 es el único con DB_MIGRATE=true: las migraciones corren aquí y
  # las otras dos arrancan con el esquema ya actualizado.
  for replica in backend1 backend2 backend3; do
    paso "Reemplazando $replica"
    docker compose up -d --no-deps --force-recreate "$replica"

    printf "   esperando a que esté sana"
    for _ in $(seq 1 60); do
      estado=$(docker inspect -f '{{.State.Health.Status}}' \
        "$(docker compose ps -q "$replica")" 2>/dev/null || echo desconocido)
      [[ "$estado" == "healthy" ]] && { echo " ✔"; break; }
      printf "."
      sleep 2
    done
    if [[ "${estado:-}" != "healthy" ]]; then
      echo " ✖"
      echo
      echo "   $replica no levantó. Últimas líneas de su registro:"
      docker compose logs --tail 40 "$replica" | sed 's/^/     /'
      echo
      echo "   Las otras réplicas siguen atendiendo. Corrija y vuelva a ejecutar."
      exit 1
    fi
  done
fi

# ── 4. Frontend ──────────────────────────────────────────────────────────
if [[ $FRONTEND -eq 1 ]]; then
  paso "Compilando el frontend"

  # `npm ci` solo cuando de verdad hace falta: son varios minutos y casi
  # ningún despliegue cambia las dependencias.
  INSTALAR="echo '   dependencias al día, no se reinstalan'"
  if [[ ! -d secad-lite/frontend/node_modules ]] \
     || [[ secad-lite/frontend/package-lock.json -nt secad-lite/frontend/node_modules ]]; then
    INSTALAR="npm ci"
  fi

  docker run --rm -v "$PWD/secad-lite/frontend:/app" -w /app node:22-alpine \
    sh -c "$INSTALAR && npx ng build --configuration production"

  COMPILADO="secad-lite/frontend/dist/frontend/browser"
  [[ -f "$COMPILADO/index.html" ]] || { echo "✖ La compilación no produjo index.html."; exit 1; }

  paso "Publicando el frontend"
  # Se publica de golpe: se arma al lado y se intercambia. Nadie alcanza a
  # cargar una página con la mitad de los archivos viejos.
  rm -rf frontend-dist.nuevo
  cp -r "$COMPILADO" frontend-dist.nuevo
  rm -rf frontend-dist.viejo
  if [[ -d frontend-dist ]]; then
    mv frontend-dist frontend-dist.viejo
  fi
  mv frontend-dist.nuevo frontend-dist
  rm -rf frontend-dist.viejo
  echo "   $(find frontend-dist -type f | wc -l) archivos publicados"
fi

# ── 5. Comprobación final ────────────────────────────────────────────────
paso "Comprobando"
docker compose ps --format 'table {{.Name}}\t{{.Status}}'
echo
if curl -sf "$SALUD" > /dev/null; then
  echo "✔ $SALUD responde."
else
  echo "✖ $SALUD NO responde. Mire: docker compose logs --tail 60 nginx backend1"
  exit 1
fi

# El archivo del TURN está montado aparte y publicar el frontend no lo pisa,
# pero si alguien lo borró la videollamada falla solo en redes móviles — un
# fallo que nadie nota hasta que un ciudadano no puede mostrar la escena.
if curl -sf "https://${DOMINIO}/config/runtime.json" | grep -q turnUrls; then
  echo "✔ La configuración del TURN se está sirviendo."
else
  echo "⚠ /config/runtime.json no responde con la configuración del TURN."
  echo "  La videollamada va a fallar en redes móviles. Revise el montaje en docker-compose.yml."
fi

echo
echo "Desplegado: $(git -C secad-lite log -1 --format='%h %s')"
