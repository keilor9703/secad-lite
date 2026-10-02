#!/usr/bin/env bash
#
# Actualiza Falcon CAD en este servidor: trae el código sobre el checkout real
# que usa Docker (~/falcon-deploy/secad-lite), reconstruye los backends y
# republica el frontend estático que sirve nginx.
#
#   ./deploy-falcon.sh              # backend y frontend
#   ./deploy-falcon.sh backend      # solo backend
#   ./deploy-falcon.sh frontend     # solo frontend
#   ./deploy-falcon.sh --respaldo   # respalda la base antes (ver abajo)
#
# El respaldo NO se hace por defecto: la mayoría de los despliegues no tocan el
# esquema y media hora de fricción diaria no se paga sola. Pero si los commits
# que entran traen migraciones, el script AVISA — ahí sí conviene correrlo con
# --respaldo, porque una migración sobre datos reales no se deshace sola.
#
# Estructura que se asume:
#   ~/falcon-deploy/docker-compose.yml
#   ~/falcon-deploy/secad-lite/      <- checkout real que construye Docker
#   ~/falcon-deploy/frontend-dist/   <- raíz que sirve nginx (bind mount)
set -euo pipefail

DEPLOY_DIR="$HOME/falcon-deploy"
REPO_DIR="$DEPLOY_DIR/secad-lite"
DIST_DIR="$DEPLOY_DIR/frontend-dist"

MODO=todo
RESPALDAR=0
for arg in "$@"; do
  case "$arg" in
    backend|--solo-backend)   MODO=backend ;;
    frontend|--solo-frontend) MODO=frontend ;;
    todo)                     MODO=todo ;;
    --respaldo)               RESPALDAR=1 ;;
    *) echo "Uso: $0 [backend|frontend|todo] [--respaldo]" >&2; exit 1 ;;
  esac
done

[[ -d "$REPO_DIR/.git" ]] || { echo "No encuentro un repo git en $REPO_DIR." >&2; exit 1; }
[[ -f "$DEPLOY_DIR/docker-compose.yml" ]] || { echo "Falta $DEPLOY_DIR/docker-compose.yml." >&2; exit 1; }
command -v rsync >/dev/null 2>&1 || {
  echo "Falta rsync: sudo apt-get update && sudo apt-get install -y rsync" >&2; exit 1; }

DOMINIO=$(grep -E '^DOMAIN=' "$DEPLOY_DIR/.env" 2>/dev/null | cut -d= -f2-)
DOMINIO=${DOMINIO:-localhost}

# ── Código ───────────────────────────────────────────────────────────────
echo "==> Actualizando código en $REPO_DIR"
cd "$REPO_DIR"
git fetch origin

# Falla fuerte si hay cambios locales sin commitear: alguien pudo haber
# parchado algo aquí mismo para salir de un apuro, y pisarlo sin avisar sería
# perder la única copia.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Hay cambios locales sin commitear en $REPO_DIR. Revíselos (git status) antes de seguir." >&2
  exit 1
fi

ANTES=$(git rev-parse HEAD)
git merge --ff-only origin/main
DESPUES=$(git rev-parse HEAD)
echo "    Ahora en: $(git log --oneline -1)"

if [[ "$ANTES" != "$DESPUES" ]]; then
  MIGRACIONES=$(git diff --name-only "$ANTES..$DESPUES" -- backend/src/migrations/ | wc -l)
  if [[ "$MIGRACIONES" -gt 0 && "$RESPALDAR" -eq 0 ]]; then
    echo
    echo "    ⚠  Entran $MIGRACIONES migración(es) de base de datos:"
    git diff --name-only "$ANTES..$DESPUES" -- backend/src/migrations/ | sed 's|.*/|       |'
    echo "       Se aplican solas al arrancar y no se deshacen solas."
    echo "       Considere: ./deploy-falcon.sh --respaldo"
    echo
  fi
fi

# ── Respaldo, solo si se pide ────────────────────────────────────────────
respaldar_base() {
  echo "==> Respaldando la base"
  cd "$DEPLOY_DIR"
  local dir="${FALCON_RESPALDOS:-/opt/falcon-backups}"
  if ! mkdir -p "$dir" 2>/dev/null || [[ ! -w "$dir" ]]; then
    dir="$HOME/falcon-backups"
    mkdir -p "$dir"
    echo "    (sin permiso en /opt/falcon-backups; se usa $dir)"
  fi
  local copia="$dir/predespliegue-$(date +%F-%H%M%S).dump"
  docker compose exec -T postgres pg_dump -U falcon -d falcon_cad -Fc > "$copia"

  # Un respaldo vacío es peor que ninguno: da la sensación de estar cubierto.
  local bytes; bytes=$(stat -c%s "$copia" 2>/dev/null || echo 0)
  if [[ "$bytes" -lt 10000 ]]; then
    echo "    ✖ El respaldo salió vacío o truncado ($bytes bytes). No se sigue." >&2
    rm -f "$copia"; exit 1
  fi
  echo "    $copia  ($(du -h "$copia" | cut -f1))"
}

actualizar_backend() {
  echo "==> Reconstruyendo la imagen del backend"
  cd "$DEPLOY_DIR"
  # Compilar antes de tocar nada: si el código no compila, el fallo sale aquí,
  # con las tres réplicas viejas todavía atendiendo.
  docker compose build backend1

  # De una en una, no las tres a la vez: así siempre queda alguien atendiendo.
  # backend1 va primero porque es el único con DB_MIGRATE=true — las otras dos
  # arrancan con el esquema ya actualizado.
  for replica in backend1 backend2 backend3; do
    echo "==> Reemplazando $replica"
    # `--build` por réplica, y no un único `build backend1`: si en el
    # docker-compose.yml cada réplica tiene su propia sección `build`, recrear
    # backend2 y backend3 reutiliza SU imagen anterior y se quedan con el
    # código viejo. El sistema queda entonces corriendo dos versiones a la vez
    # y nginx reparte entre ellas: una de cada tres peticiones usa la vieja.
    # El síntoma es desquiciante —una ruta nueva responde 404 a veces y 200
    # otras, un formulario guarda unas veces sí y otras no— y no se parece en
    # nada a su causa.
    docker compose up -d --no-deps --force-recreate --build "$replica"

    local estado=desconocido
    printf "    esperando a que esté sana"
    for _ in $(seq 1 60); do
      estado=$(docker inspect -f '{{.State.Health.Status}}' \
        "$(docker compose ps -q "$replica")" 2>/dev/null || echo desconocido)
      [[ "$estado" == "healthy" ]] && { echo " ✔"; break; }
      printf "."
      sleep 2
    done
    if [[ "$estado" != "healthy" ]]; then
      echo " ✖"
      echo "    $replica no levantó. Últimas líneas de su registro:" >&2
      docker compose logs --tail 40 "$replica" | sed 's/^/      /' >&2
      echo "    Las otras réplicas siguen atendiendo. Corrija y vuelva a ejecutar." >&2
      exit 1
    fi
  done

  verificar_replicas
}

actualizar_frontend() {
  echo "==> Compilando el frontend"
  # Dentro de un contenedor: el servidor no necesita tener Node instalado, ni
  # la versión correcta. `npm ci` solo cuando cambiaron las dependencias —son
  # varios minutos y casi ningún despliegue las toca.
  local instalar="echo '    dependencias al día, no se reinstalan'"
  if [[ ! -d "$REPO_DIR/frontend/node_modules" ]] \
     || [[ "$REPO_DIR/frontend/package-lock.json" -nt "$REPO_DIR/frontend/node_modules" ]]; then
    instalar="npm ci"
  fi
  docker run --rm -v "$REPO_DIR/frontend:/app" -w /app node:22-alpine \
    sh -c "$instalar && npx ng build --configuration production"

  local salida="$REPO_DIR/frontend/dist/frontend/browser"
  [[ -f "$salida/index.html" ]] || {
    echo "No encuentro $salida/index.html — revise angular.json (outputPath)." >&2; exit 1; }

  echo "==> Publicando en $DIST_DIR"
  # IMPORTANTE: nginx tiene $DIST_DIR montado con --bind desde que arrancó el
  # contenedor, y ese bind apunta al DIRECTORIO (inodo) que existía entonces.
  # Reemplazar el directorio entero (mv, o rm -rf + mkdir) deja al contenedor
  # viendo la carpeta vieja: serviría el frontend anterior, o un 403, hasta
  # recrearlo. Se sincroniza el CONTENIDO dentro del mismo directorio, que el
  # bind sí refleja al instante. `--delete` quita los paquetes de versiones
  # anteriores, que si no se van acumulando para siempre.
  #
  # `--checksum` y no la comprobación rápida por tamaño+fecha: un index.html
  # con el mismo tamaño y la misma marca de tiempo que el publicado se daría
  # por igual y NO se copiaría —el despliegue diría «listo» sirviendo la
  # versión anterior—. Son unos pocos MB: leerlos cuesta milisegundos y quita
  # de encima toda esa clase de sorpresa.
  #
  # `--exclude=/config/` protege a runtime.json, que NO sale de la compilación
  # sino del servidor (lleva la credencial del TURN). Sin esta exclusión,
  # `--delete` lo borraría en cada despliegue y la videollamada se quedaría sin
  # TURN —falla solo en datos móviles, que es donde nadie prueba—.
  mkdir -p "$DIST_DIR"
  rsync -a --delete --checksum --exclude='/config/' "$salida/" "$DIST_DIR/"
  echo "    $(find "$DIST_DIR" -path "$DIST_DIR/config" -prune -o -type f -print | wc -l) archivos publicados"

  publicar_runtime
  verificar_montaje
}

# El runtime.json vive en el servidor, no en el repositorio, y se copia DENTRO
# de la raíz que sirve nginx. Se copia en vez de montarse: un bind mount a
# $DIST_DIR/config/runtime.json exigiría que ese directorio existiera en el
# host, y el rsync de arriba lo borraría —dejando el montaje del contenedor
# apuntando a algo que ya no existe, sin que nada falle a la vista—. Copiarlo en
# cada despliegue también garantiza que lo servido y el archivo del servidor no
# se separen nunca.
#
# La credencial del TURN no es un secreto frente al usuario: el navegador de
# cada ciudadano la recibe para poder negociar. Está fuera del repositorio para
# que no quede en el historial de git y para poder rotarla sin recompilar.
publicar_runtime() {
  local origen="$DEPLOY_DIR/runtime.json"
  if [[ ! -f "$origen" ]]; then
    echo "    ⚠ No existe $origen: la videollamada irá SIN TURN (falla en datos móviles)."
    echo "      Ver deploy/README.md para crearlo."
    return
  fi
  # Publicar un JSON roto deja el frontend sin TURN y sin pista de por qué.
  # Si no hay python3, se publica igual: no tener validador no es motivo para
  # no desplegar.
  if command -v python3 >/dev/null 2>&1; then
    if ! python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$origen" 2>/dev/null; then
      echo "    ✖ $origen no es JSON válido. No se publica." >&2
      exit 1
    fi
  fi
  mkdir -p "$DIST_DIR/config"
  cp "$origen" "$DIST_DIR/config/runtime.json"
  chmod 644 "$DIST_DIR/config/runtime.json"
  echo "    ✔ runtime.json publicado (configuración del TURN)"
}

# Publicar en el host no prueba nada: lo que importa es qué ve nginx. Si el
# directorio fue reemplazado alguna vez (un `mv`, un `rm -rf` + `mkdir`), el
# bind del contenedor sigue apuntando al inodo viejo y nginx sirve el frontend
# anterior —o un 403, si ese inodo quedó vacío— aunque el host esté perfecto.
# Desde fuera es indistinguible de un despliegue correcto, así que se comprueba
# DENTRO del contenedor y, si no coincide, se recrea: es la única forma de
# volver a enganchar el bind.
verificar_montaje() {
  local raiz=/usr/share/nginx/html
  local esperado; esperado=$(md5sum "$DIST_DIR/index.html" | cut -d' ' -f1)

  local visto
  visto=$(docker compose exec -T nginx md5sum "$raiz/index.html" 2>/dev/null | cut -d' ' -f1 || true)

  if [[ "$visto" == "$esperado" ]]; then
    echo "    ✔ nginx está viendo esta publicación"
    return
  fi

  if [[ -z "$visto" ]]; then
    echo "    ⚠ nginx no encuentra index.html: su montaje quedó colgado de un directorio viejo."
  else
    echo "    ⚠ nginx está sirviendo OTRA versión: su montaje quedó colgado de un directorio viejo."
  fi
  echo "    Recreando el contenedor para reenganchar el montaje..."
  docker compose up -d --force-recreate --no-deps nginx

  # Recrear tarda un instante en tener el proceso listo para `exec`.
  for _ in $(seq 1 15); do
    visto=$(docker compose exec -T nginx md5sum "$raiz/index.html" 2>/dev/null | cut -d' ' -f1 || true)
    [[ -n "$visto" ]] && break
    sleep 1
  done

  if [[ "$visto" != "$esperado" ]]; then
    echo "    ✖ Tras recrearlo, nginx sigue sin ver esta publicación." >&2
    echo "      Revise el volumen de nginx en docker-compose.yml: debe montar" >&2
    echo "      $DIST_DIR en $raiz." >&2
    exit 1
  fi
  echo "    ✔ Montaje reenganchado; nginx ya ve esta publicación"
}

# Que cada réplica arranque sana no basta: pueden estar sanas y ser versiones
# distintas. Esto es lo que no comprobaba el script, y costó una noche entera.
verificar_replicas() {
  local imagenes=() replica id
  for replica in backend1 backend2 backend3; do
    id=$(docker compose ps -q "$replica" 2>/dev/null) || id=''
    imagenes+=("${id:+$(docker inspect -f '{{.Image}}' "$id" 2>/dev/null)}")
  done

  if [[ -n "${imagenes[0]}" && "${imagenes[0]}" == "${imagenes[1]}" && "${imagenes[1]}" == "${imagenes[2]}" ]]; then
    echo "    ✔ las tres réplicas corren la misma imagen"
    return
  fi

  echo "    ✖ Las réplicas NO corren la misma imagen del backend." >&2
  local i=0
  for replica in backend1 backend2 backend3; do
    echo "        $replica: ${imagenes[$i]:-(sin contenedor)}" >&2
    i=$((i + 1))
  done
  echo "      Con versiones distintas, nginx reparte entre ellas y el sistema" >&2
  echo "      responde bien o mal según a cuál le toque. Pare y revise las" >&2
  echo "      secciones 'build' de backend1/2/3 en docker-compose.yml." >&2
  exit 1
}

[[ $RESPALDAR -eq 1 ]] && respaldar_base
case "$MODO" in
  backend)  actualizar_backend ;;
  frontend) actualizar_frontend ;;
  todo)     actualizar_backend; actualizar_frontend ;;
esac

# ── Comprobación ─────────────────────────────────────────────────────────
echo "==> Comprobando"
cd "$DEPLOY_DIR"
docker compose ps --format 'table {{.Name}}\t{{.Status}}'
echo

if curl -sfk -H "Host: $DOMINIO" https://localhost/api/health > /dev/null; then
  echo "✔ La API responde."
else
  echo "✖ La API NO responde. Mire: docker compose logs --tail 60 nginx backend1" >&2
  exit 1
fi

# Si falta, la videollamada falla SOLO en redes móviles: un fallo que nadie
# nota hasta que un ciudadano no puede mostrar la escena.
CONF=$(curl -sfk -H "Host: $DOMINIO" https://localhost/config/runtime.json 2>/dev/null || true)
if ! grep -q turnUrls <<<"$CONF"; then
  echo "⚠ /config/runtime.json no trae la configuración del TURN."
  if grep -qi '<!doctype html' <<<"$CONF"; then
    echo "  Devuelve el index.html, así que el archivo no está: cree"
    echo "  $DEPLOY_DIR/runtime.json y vuelva a desplegar. Ver deploy/README.md."
  else
    echo "  Revise $DIST_DIR/config/runtime.json. Ver deploy/README.md."
  fi
  echo "  Mientras falte, la videollamada falla en redes móviles."
elif grep -q 'CAMBIE-ESTO' <<<"$CONF"; then
  # Peor que faltar: el frontend cree tener TURN, lo intenta, y la negociación
  # muere con 401 en vez de caer limpio a solo-STUN.
  echo "⚠ runtime.json se sirve, pero lleva la credencial de ejemplo sin cambiar."
  echo "  Póngale la real: sudo grep '^user=' /etc/turnserver.conf"
else
  echo "✔ La configuración del TURN se está sirviendo."
fi

echo
echo "Desplegado: $(git -C "$REPO_DIR" log -1 --format='%h %s')"
