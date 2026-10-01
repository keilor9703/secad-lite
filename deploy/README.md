# Configuración de despliegue

## `runtime.json` — ajustes que se resuelven en el servidor

El frontend lee `/config/runtime.json` **al arrancar**, antes de montar la
aplicación. Hoy lleva un solo ajuste: el servidor TURN de la videollamada.

Estaba dentro de `environment.prod.ts` —es decir, dentro del código— y eso
tenía dos problemas: la credencial quedaba escrita en el repositorio y en el
historial de git, y cambiar de servidor TURN obligaba a recompilar el frontend
y volver a desplegarlo.

### Cómo se instala

1. Copie `runtime.json.example` como `runtime.json` junto a su
   `docker-compose.yml`, y ponga la credencial real:

   ```bash
   sudo grep '^user=' /etc/turnserver.conf   # usuario:clave del coturn
   ```

2. Móntelo en el servicio `nginx` del `docker-compose.yml`:

   ```yaml
     nginx:
       volumes:
         - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
         - ./frontend-dist:/usr/share/nginx/html:ro
         - ./certs:/etc/nginx/certs:ro
         - ./runtime.json:/usr/share/nginx/html/config/runtime.json:ro   # ← agregar
   ```

3. `docker compose up -d --force-recreate nginx`

Al estar montado como archivo, **recompilar y volver a copiar el frontend no lo
pisa**: el contenido del host es el que se sirve, pase lo que pase en
`frontend-dist`.

### Verificación

```bash
curl -s https://<su-dominio>/config/runtime.json
```

Debe devolver el JSON. Si devuelve el `index.html` de la aplicación, el montaje
no quedó: nginx está resolviendo la ruta con el `try_files ... /index.html`.

### Si el archivo no existe

La aplicación arranca igual, con STUN y sin TURN, y deja un aviso en la consola
del navegador. La videollamada funciona en la mayoría de las redes y falla en
las móviles con NAT simétrico de operador. Es un modo degradado a propósito: un
CAD no puede negarse a abrir porque falte un archivo de ajustes.
