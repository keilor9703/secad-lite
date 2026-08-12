# Imagen del backend de FALCON CAD (NestJS). Multi-stage: compila con las
# devDependencies y deja en la imagen final solo lo necesario para correr.
#
# Build:  docker build -t falcon-cad-api ./backend
# Run:    docker run -p 3000:3000 --env-file backend/.env falcon-cad-api
#
# La app ya lee PORT de env y escucha en 0.0.0.0 (ver src/main.ts), y expone
# /api/health — úsalo como readiness/liveness probe en Kubernetes o en
# cualquier balanceador delante del contenedor.

# Se toma de mirror.gcr.io (espejo de Docker Hub) en vez de docker.io
# directamente: Docker Hub limita las descargas anónimas por IP, y en un
# clúster con varios nodos jalando la misma imagen es fácil chocar contra
# ese límite. Cualquier registro (ECR, el registro del propio clúster) sirve
# igual; este es solo un espejo gratuito y sin cuenta.
FROM mirror.gcr.io/library/node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
# Deja node_modules solo con lo que hace falta en tiempo de ejecución: las
# devDependencies (TypeScript, ESLint, Jest…) ya cumplieron su función en el
# paso de arriba y no viajan a la imagen final.
RUN npm prune --omit=dev

FROM mirror.gcr.io/library/node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./

# La imagen base ya trae un usuario sin privilegios llamado "node".
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

CMD ["node", "dist/main.js"]
