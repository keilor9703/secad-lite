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

2. Móntelo en el servicio `nginx` del `docker-compose.yml`, **fuera de la raíz
   del frontend**:

   ```yaml
     nginx:
       volumes:
         - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
         - ./frontend-dist:/usr/share/nginx/html:ro
         - ./certs:/etc/nginx/certs:ro
         - ./runtime.json:/etc/nginx/falcon-runtime.json:ro   # ← agregar
   ```

3. Publíquelo en `nginx.conf`, dentro del `server{}` del 443 y **antes** del
   `location /`:

   ```nginx
   location = /config/runtime.json {
       alias /etc/nginx/falcon-runtime.json;
       default_type application/json;
       add_header Cache-Control "no-store";
   }
   ```

4. `docker compose up -d --force-recreate --no-deps nginx`

### Por qué no se monta dentro de `frontend-dist`

Lo natural sería montarlo en `/usr/share/nginx/html/config/runtime.json` y
dejar que nginx lo sirva como un archivo estático más. **No funciona, y falla
callado.** Esa ruta es `frontend-dist/config/` en el host, y el despliegue
sincroniza esa carpeta con `rsync --delete`; la compilación de Angular no
produce ningún `config/`, así que el primer despliegue siguiente borra el
directorio y el montaje del contenedor queda apuntando a algo que ya no
existe. Nada falla a la vista: el despliegue sale en verde, la aplicación
arranca, y la videollamada empieza a caerse **solo en datos móviles**, que es
justo donde nadie prueba.

Con el `alias`, el archivo vive fuera de la raíz servida y ningún despliegue lo
toca. Rotar la credencial o cambiar de servidor TURN sigue sin exigir
recompilar: se edita `runtime.json`, se recrea nginx, y los navegadores lo
toman al recargar (de ahí el `no-store`).

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
