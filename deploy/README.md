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

2. Listo. El despliegue lo publica solo: `deploy-falcon.sh` lo copia a
   `frontend-dist/config/runtime.json` después de compilar, y nginx lo sirve
   como un archivo estático más. No hay que tocar `docker-compose.yml` ni
   `nginx.conf`.

   Para publicarlo sin esperar al próximo despliegue:

   ```bash
   cd ~/falcon-deploy
   mkdir -p frontend-dist/config
   cp runtime.json frontend-dist/config/runtime.json
   chmod 644 frontend-dist/config/runtime.json
   ```

### Por qué se copia y no se monta

Lo natural sería montarlo con un volumen en
`/usr/share/nginx/html/config/runtime.json`. **No funciona, y falla callado.**
Esa ruta es `frontend-dist/config/` en el host, y el despliegue sincroniza esa
carpeta con `rsync --delete`; la compilación de Angular no produce ningún
`config/`, así que el primer despliegue siguiente borra el directorio y el
montaje del contenedor queda apuntando a algo que ya no existe. Nada falla a la
vista: el despliegue sale en verde, la aplicación arranca, y la videollamada se
degrada a solo-STUN — invisible en WiFi, rota en datos móviles.

Copiándolo, el script lo repone en cada despliegue (y `rsync` lleva
`--exclude=/config/` para no borrarlo entre medias), así que lo servido y el
archivo del servidor no pueden separarse.

### La credencial del TURN no es un secreto frente al usuario

El navegador de cada ciudadano la recibe: sin ella no puede negociar. Sacarla
del repositorio sirve para que no quede en el historial de git para siempre y
para poder rotarla sin recompilar el frontend — no para ocultarla del cliente.
Por eso el archivo publicado es 644 y de lectura pública: así tiene que ser.

### Verificación

```bash
curl -s https://<su-dominio>/config/runtime.json
```

Debe devolver el JSON. Si devuelve el `index.html` de la aplicación, el archivo
no está en `frontend-dist/config/`: lo está resolviendo el `try_files ... /index.html`.

### Si el archivo no existe

La aplicación arranca igual, con STUN y sin TURN, y deja un aviso en la consola
del navegador. La videollamada funciona en la mayoría de las redes y falla en
las móviles con NAT simétrico de operador. Es un modo degradado a propósito: un
CAD no puede negarse a abrir porque falte un archivo de ajustes.
