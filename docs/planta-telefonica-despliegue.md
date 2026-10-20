# Manual de despliegue de una planta telefónica

> **Qué es este documento.** El procedimiento completo para montar una planta
> de FALCON CAD en un servidor, y para migrarla a otro. Está escrito como un
> guion: si se sigue en orden, la planta queda atendiendo llamadas con audio en
> los dos sentidos.
>
> **Reemplaza a `montar-planta-propia-paso-a-paso.md`**, que quedó obsoleto: sus
> comandos producían una planta sin audio.
>
> Su hermano es [`planta-telefonica-funcionalidades.md`](planta-telefonica-funcionalidades.md),
> que explica *qué hace* cada pieza. Este explica *cómo se instala*.
>
> Escrito el 20/10/2026, después de poner la primera planta en producción. Todo
> lo que dice la sección 10 pasó de verdad.

---

## Cómo leer este documento

- **Secciones 1 a 8**: instalar una planta en un servidor nuevo. En orden.
- **Sección 9**: migrar una planta que ya existe a otro servidor (Bogotá).
- **Sección 10**: la tabla de averías. Síntoma → causa → comprobación → arreglo.
- **Sección 11**: el orden correcto de diagnóstico cuando no hay audio. Esta es
  la sección que evita repetir la noche del 19 de octubre.

**Regla de oro, antes de empezar:** la configuración de Asterisk **no se edita a
mano en el servidor**. Se edita en FALCON y se vuelve a aplicar. Cada arreglo a
mano es una bomba de tiempo que estalla en el siguiente *Aplicar*, y ya nos pasó
dos veces en un solo día (el `Dockerfile` y el `media_address`).

---

## 1. Lo que hay que tener antes de empezar

| Qué | Para qué | Cómo se consigue |
|---|---|---|
| Un servidor Linux con Docker | Correr el contenedor | Ubuntu 22.04+ |
| Acceso SSH y `sudo` | Todo | |
| Acceso a la consola de la nube | Abrir puertos | OCI, AWS, … |
| Un nombre DNS para la planta | El navegador entra por nombre | Un registro `A` |
| Acceso al panel del operador telefónico | Apuntar la troncal a este servidor | Infobip, … |
| Superadmin en FALCON | Dar de alta la planta | |

---

## 2. Los cuatro datos del servidor

**Esta es la sección más importante del documento.** Hay cuatro direcciones IP
en juego, no son la misma, y confundirlas es la causa de casi todas las averías
de audio. Recójalas antes de tocar nada.

```bash
# Las IPv4 de todas las interfaces
ip -4 -o addr show | awk '{print $2, $4}'

# ¿Quién tiene el 80, el 443 y el puerto que va a usar la planta?
sudo ss -lntp | grep -E ':(80|443|8100)\s'

# ¿Qué tiene Docker montado y en qué red?
sudo docker ps --format '{{.Names}}\t{{.Ports}}'

# ¿Qué deja pasar el cortafuegos del host?
sudo iptables -S INPUT | head -20
```

Con eso se llenan los cuatro:

### `ipPublica` — la que ve el mundo

La IP por la que llega el tráfico de internet. En la nube casi nunca está en
ninguna interfaz: hay NAT 1:1 por detrás.

> Si `servidor` ya es una IP pública, FALCON usa esa y no hace falta llenarla.

### `ipPrivada` — la de la interfaz real

La de la interfaz principal (`enp0s6`, `eth0`, …). **No** la de `lo`, **no** las
de `docker0` ni `br-*`.

De ella salen dos cosas, y sin ella no hay audio del lado del navegador:

1. **Dónde abre Asterisk el socket de audio** (`media_address` +
   `bind_rtp_to_media_address`). Sin esto, Asterisk hereda la dirección del
   transporte del WebSocket, que es `127.0.0.1`, y el audio del operador abre
   en el bucle local: sus paquetes rebotan con *ICMP port unreachable*.
2. **Qué dirección anuncia en los candidatos ICE** (`[ice_host_candidates]`),
   mapeada a la pública.

### `ipInterna` — por dónde el nginx del 443 alcanza a la planta

Depende de **dónde corre ese nginx**:

| Dónde corre nginx | Valor |
|---|---|
| En el propio host, o en un contenedor en red host | `127.0.0.1` |
| En un contenedor en red bridge | La IP del host en el puente de Docker (`ip -4 addr show docker0`, normalmente `172.17.0.1`) |

Con `127.0.0.1` cuando nginx está en un contenedor bridge, nginx se habla a sí
mismo: 502 en el WebSocket y botón «Llamar» mudo, sin una línea en ningún log.

### El nombre DNS

Un registro `A` apuntando a la `ipPublica`. Convención:
`<municipio>-pbx.<dominio>`, o el mismo nombre con el que se sirve la consola si
se decide compartirlo (ver sección 6.2).

---

## 3. Abrir los puertos

Son **dos puertas** y hay que mirar las dos. Que una esté abierta no dice nada
de la otra.

### 3.1. La nube

En OCI: Networking → VCN → Subnets → la subred → Security List → *Add Ingress
Rules*.

| Regla | Source | Protocolo | **Destination** Port Range |
|---|---|---|---|
| SIP | `0.0.0.0/0` (o las redes del SBC) | UDP | `5060` |
| Audio | `0.0.0.0/0` | UDP | `20500-20999` |
| Web | `0.0.0.0/0` | TCP | `443` |

**El rango va en *Destination*, nunca en *Source*.** Puesto en Source no abre
nada y además deja un hueco. Es un error que ya cometimos con la regla de
coturn.

> Los puertos exactos los dice FALCON en la pantalla de la planta. El rango de
> audio cambia por municipio.

### 3.2. El host

```bash
sudo iptables -S INPUT | head -5
```

Si la primera línea dice `-P INPUT ACCEPT` y no hay un `REJECT` al final, **no
hay nada que hacer**. Si la política es restrictiva:

```bash
sudo iptables -I INPUT 1 -p udp --dport 5060 -j ACCEPT
sudo iptables -I INPUT 1 -p udp --dport 20500:20999 -j ACCEPT
sudo netfilter-persistent save
```

### 3.3. Comprobar que de verdad llega

No lo dé por hecho porque la regla figure en la lista. Con esto corriendo, haga
una llamada de prueba:

```bash
sudo timeout 45 tcpdump -nni any udp port 5060
```

Tiene que aparecer un `INVITE` desde las redes del operador telefónico. Si no
aparece nada, el SIP no está llegando y no hay nada más que mirar en el
servidor.

---

## 4. El certificado

El navegador **no abre un WebSocket sobre un certificado que no confía**, y a
diferencia de una página normal **no hay botón de «continuar igual»**: el `wss://`
falla y punto. El certificado tiene que ser válido de verdad.

```bash
sudo certbot certonly --webroot -w <raíz que sirve el nginx del 443> -d <nombre>
```

Si el 80 lo tiene un contenedor, el `--webroot` igual funciona siempre que ese
nginx sirva archivos estáticos desde una carpeta del host: certbot escribe el
desafío ahí y el contenedor lo sirve.

**Comprobar que el certificado es público y no uno interno:**

```bash
sudo openssl x509 -noout -subject -issuer -enddate -in /etc/letsencrypt/live/<nombre>/cert.pem
```

El `issuer` tiene que ser una CA pública. Un certificado llamado `origin.pem` o
emitido por la propia nube **no sirve** para esto si no hay un proxy confiado
delante.

### 4.1. La renovación, cuando el 80/443 los tiene Docker

`certbot renew` falla si su configuración guardada usa el autenticador `nginx` y
el nginx del sistema no puede tomar los puertos. Se corrige reemitiendo con
`--webroot`, que deja guardado ese método:

```bash
sudo certbot certonly --webroot -w <raíz> -d <nombre> --cert-name <nombre>
sudo certbot renew --dry-run
```

Y si el nginx que sirve el 443 lee el certificado de **otra carpeta** (no de
`/etc/letsencrypt`), hace falta un *hook* que lo copie al renovar, o el día de la
renovación el softphone deja de conectar sin que nadie sepa por qué:

```bash
sudo mkdir -p /etc/letsencrypt/renewal-hooks/deploy
printf '%s\n' '#!/bin/sh' 'set -e' \
  'cp /etc/letsencrypt/live/<nombre>/fullchain.pem <destino>/fullchain.pem' \
  'cp /etc/letsencrypt/live/<nombre>/privkey.pem <destino>/privkey.pem' \
  'chmod 600 <destino>/privkey.pem' \
  'docker exec <contenedor-nginx> nginx -s reload || true' \
  | sudo tee /etc/letsencrypt/renewal-hooks/deploy/falcon-pbx.sh >/dev/null
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/falcon-pbx.sh
sudo sh -n /etc/letsencrypt/renewal-hooks/deploy/falcon-pbx.sh && echo ok
```

---

## 5. Registrar la planta en FALCON

**Plataforma → Nuestras centralitas → Dar de alta.** Luego, en la planta:

| Campo | Qué poner |
|---|---|
| Servidor | La IP o el nombre por el que se entra por SSH |
| IP pública | Solo si `servidor` es un nombre |
| **IP privada** | La de la interfaz real (sección 2) |
| **IP interna** | `127.0.0.1` o la del puente de Docker (sección 2) |
| Nombre | El registro DNS de la sección 2 |

Después:

1. **Troncal** — operador, servidor SBC, puerto, autenticación, redes del SBC,
   canales. Las redes en CIDR, separadas por coma. *Un CIDR mal escrito hace que
   Asterisk rechace el módulo pjsip entero.*
2. **Número** — el DID o el número corto, su troncal, y el destino (`cola`).
3. Revisar el bloque **«qué le falta»**. Si dice algo, resuélvalo antes de
   aplicar.

---

## 6. nginx: publicar el 443

Primero hay que saber **quién tiene el 443**:

```bash
sudo ss -lntp | grep ':443\s'
```

### 6.1. Si lo tiene el nginx del sistema

`aplicar.sh` lo hace solo: enlaza el sitio generado en `sites-enabled`,
comprueba con `nginx -t` y recarga.

### 6.2. Si lo tiene otro servicio (un contenedor, normalmente)

`aplicar.sh` lo detecta, **no aborta**, deja el sitio escrito y avisa. Hay que
engancharlo a mano, y hay una decisión que tomar:

```bash
sudo docker inspect <contenedor-nginx> --format \
  'red={{.HostConfig.NetworkMode}}{{range .Mounts}} | {{.Source}} -> {{.Destination}}{{end}}'
sudo grep -n "server_name\|listen\|ssl_certificate" <su nginx.conf>
```

**La decisión:**

| Si el nombre de la planta… | Entonces |
|---|---|
| **No lo sirve nadie todavía** | Copie el sitio generado a la configuración de ese nginx |
| **Cae en un `server_name _;` que sirve la consola de FALCON** | **No** cree un `server` nuevo con ese nombre: le quitaría la consola. Agregue los dos `location` **dentro** del bloque que ya existe |

El segundo caso es además el mejor: mismo origen para la consola y el softphone,
sin nombre DNS extra y sin certificado extra. Los dos `location`:

```nginx
    location = /ws {
        proxy_pass http://<ipInterna>:<puertoHttp>/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location /ari/ {
        proxy_pass http://<ipInterna>:<puertoHttp>/ari/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
```

Si ese nginx está en **red bridge**, `<ipInterna>` es la del puente de Docker y
además puede hacer falta abrir ese puerto para los contenedores:

```bash
sudo iptables -I INPUT 1 -p tcp -d 172.17.0.1 --dport <puertoHttp> -j ACCEPT
sudo netfilter-persistent save
```

### 6.3. Comprobar el 443 antes de seguir

```bash
curl -sS -i -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
     -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
     -H 'Sec-WebSocket-Protocol: sip' https://<nombre>/ws | head -3
```

**Tiene que decir `HTTP/1.1 101 Switching Protocols`**, y **sin `-k`**.

| Respuesta | Qué significa |
|---|---|
| `101 Switching Protocols` | Correcto |
| `502` | nginx no alcanza la planta: revise `ipInterna` y el cortafuegos |
| `200` con HTML | No entró al `location`: se lo comió el `try_files` |
| Error de certificado | El certificado no es público (sección 4) |

---

## 7. Aplicar

En FALCON, botón **Aplicar**. Descarga `aplicar.sh`. Súbalo al servidor:

```bash
scp -i <su llave> aplicar.sh usuario@<servidor>:/tmp/
```

**`aplicar.sh` es una credencial**: lleva dentro la API key del tenant, las
claves SIP de los operadores y la de ARI. No lo pegue en un chat, no lo suba a
git, no lo mande por mensajería. Bórrelo en cuanto termine.

```bash
sudo bash /tmp/aplicar.sh && shred -u /tmp/aplicar.sh
```

El script construye la imagen la primera vez (unos 30 segundos), escribe la
configuración, levanta el contenedor e imprime unas comprobaciones.

---

## 8. Comprobar, en este orden

Cada paso supone que el anterior salió bien. **No salte ninguno**: el orden está
puesto para que cada falla aparezca donde es barata de arreglar.

### 8.1. El contenedor está arriba

```bash
sudo docker ps --filter name=asterisk-<instancia>
sudo docker exec asterisk-<instancia> asterisk -rx 'core show version'
```

Debe decir `Up`, y la versión debe salir **sin** ningún aviso de configuración.

### 8.2. Los transportes y los módulos

```bash
sudo docker exec asterisk-<instancia> asterisk -rx 'pjsip show transports'
sudo docker exec asterisk-<instancia> asterisk -rx 'module show like chan_sip'
```

- `transport-udp` en `0.0.0.0:<puertoSip>`, y `transport-ws` en
  `127.0.0.1:<puertoHttp>`.

> **Sí: el `transport-ws` dice `127.0.0.1` y el `http.conf` dice otra cosa, y
> está bien.** El transporte de WebSocket de pjsip no abre ningún socket —el
> WebSocket lo sirve el servidor HTTP de `http.conf`, que es el que escucha de
> verdad en `ipInterna`—, así que ese `bind` es nominal.
>
> Pero **no es inocuo**: es la dirección de la que Asterisk hereda dónde abrir
> el socket de audio, y por eso hace falta `media_address` +
> `bind_rtp_to_media_address` en cada operador. Es exactamente la avería de la
> sección 10.3.
- `chan_sip`: **0 módulos**. Si está cargado, se pelea con pjsip por el
  subprotocolo del WebSocket y el registro del navegador termina en un 403 mudo.

### 8.3. Las extensiones y la cola

```bash
sudo docker exec asterisk-<instancia> asterisk -rx 'pjsip show endpoints' | grep -E "^ Endpoint"
sudo docker exec asterisk-<instancia> asterisk -rx 'queue show cola-<instancia>'
```

Las extensiones salen `Unavailable` hasta que alguien abra el navegador. La cola
debe tener a todos los operadores como miembros.

### 8.4. El softphone se registra

Abra FALCON con un operador que tenga extensión y repita:

```bash
sudo docker exec asterisk-<instancia> asterisk -rx 'pjsip show endpoints' | grep -E "^ Endpoint"
```

**Su extensión tiene que pasar a `Not in use`.** Si sigue en `Unavailable`:

- Revise que la dirección del softphone sea `wss://<nombre>/ws` (debe salir de
  la planta, no estar tecleada en «Configuración e integraciones»).
- Revise la consola del navegador (F12) por un error de WebSocket.
- Repita la comprobación 6.3.

### 8.5. Los sockets de audio están donde deben

**Con una llamada contestada**, en el host:

```bash
sudo ss -lunp | grep -i asterisk
```

**Ninguna línea puede decir `127.0.0.1`.** Si la hay, ese es el socket de audio
del navegador abierto en el bucle local, y la llamada se va a contestar sin que
se oiga nada. Causa: falta `ipPrivada` en la planta (sección 2).

### 8.6. La llamada entra

```bash
sudo timeout 45 tcpdump -nni any udp port 5060
```

Marque el número. La secuencia correcta:

```
INVITE  →  100 Trying  →  180 Ringing  →  200 OK  →  ACK
```

- Si no aparece nada: el SIP no llega. Sección 3.
- Si llega hasta `180 Ringing` y después `CANCEL`: entró bien y **nadie
  contestó**. Vuelva a 8.4.

### 8.7. Hay audio en los dos sentidos

Con la llamada contestada:

```bash
sudo timeout 30 tcpdump -nni any 'udp portrange <rtpDesde>-<rtpHasta>' -c 40
```

**Tiene que haber paquetes `In` y `Out`.** Solo `In` significa que Asterisk
recibe y no manda: vaya a la sección 11.

### 8.8. La grabación llega al caso

Cuelgue y abra el caso en FALCON. La grabación debe aparecer en la ficha, en
estado *en custodia*.

---

## 9. Migrar a un servidor nuevo (Bogotá)

Esta es la razón por la que todo lo de arriba está en campos de FALCON y no en
archivos escritos a mano. **La migración no copia archivos: vuelve a generar.**

### 9.1. Antes de tocar nada

- [ ] El servidor nuevo tiene Docker y acceso SSH.
- [ ] Sabe cuál va a ser la ventana de corte. Durante la migración **no entran
      llamadas**: la troncal apunta a un solo sitio.
- [ ] Tiene a mano el panel del operador telefónico para cambiar el destino.

### 9.2. Preparar el servidor nuevo, sin cortar el viejo

Todo esto se hace con la planta vieja atendiendo:

1. **Recoja los cuatro datos** del servidor nuevo (sección 2). Anótelos; no los
   meta todavía en FALCON.
2. **Abra los puertos** en la nube y en el host del servidor nuevo (sección 3).
3. **Cree el registro DNS**. Si va a conservar el mismo nombre, créelo **con
   TTL bajo** (300 s) unas horas antes, apuntando todavía al servidor viejo: así
   el cambio luego es casi inmediato.
4. **Emita el certificado** en el servidor nuevo (sección 4). Con `--webroot` y
   el DNS apuntando al viejo esto no funciona todavía; en ese caso emítalo justo
   después del corte, o use validación por DNS.
5. **Prepare nginx** en el servidor nuevo (sección 6), con el sitio listo pero
   sin tráfico.

### 9.3. El corte

Ventana estimada: **10 a 20 minutos**.

1. **En FALCON**, en la planta del municipio, cambie:
   - `servidor` → el servidor nuevo
   - `ipPublica`, `ipPrivada`, `ipInterna` → las del servidor nuevo
   - `dominioSip` → solo si cambia de nombre

   Guarde. FALCON reescribe `config_pbx` solo.

   > Los **puertos no se tocan**. Si el servidor nuevo está vacío, la misma
   > ranura vale.

2. **Aplicar**, y correr `aplicar.sh` en el servidor nuevo (sección 7).

3. **Comprobaciones 8.1 a 8.5** en el servidor nuevo. Las extensiones se
   registran solas en cuanto los operadores recarguen la consola.

4. **Cambie el DNS** al servidor nuevo, si conserva el nombre.

5. **Cambie el destino en el operador telefónico**: host y puerto del servidor
   nuevo. *Este es el punto de no retorno.*

6. **Comprobaciones 8.6 a 8.8**: llamada de prueba completa, con audio y
   grabación.

7. **Apague la planta vieja**, sin borrarla todavía:

   ```bash
   sudo docker stop asterisk-<instancia>
   ```

### 9.4. Después del corte

- [ ] Suba el TTL del DNS otra vez.
- [ ] **Las grabaciones que quedaron en el servidor viejo.** Mire
      `/opt/falcon-pbx/<instancia>/grabaciones/`: lo que haya ahí es audio que
      no se pudo subir. Súbalo o consérvelo antes de dar de baja la máquina.
- [ ] El `aplicar.sh` en el servidor viejo: `shred -u`.
- [ ] **Rote la API key** del tenant: otro *Aplicar* la rota sola.
- [ ] Espere una semana antes de borrar la máquina vieja.

### 9.5. Si hay que devolverse

Mientras la planta vieja exista y no se haya borrado:

1. Devuelva el destino en el operador telefónico al servidor viejo.
2. `sudo docker start asterisk-<instancia>` en el viejo.
3. En FALCON, devuelva los campos de IP y vuelva a aplicar **en el viejo**.

Por eso el paso 7 del corte es *apagar*, no *borrar*.

---

## 10. Tabla de averías

Todo lo de esta tabla pasó de verdad. La columna **«qué se mide»** es la que
importa: dice cómo confirmar la causa en vez de probar el arreglo a ver si suena.

### 10.1. No entra la llamada

| Síntoma | Causa | Qué se mide | Arreglo |
|---|---|---|---|
| `tcpdump` en el 5060 no ve nada | El puerto no está abierto en la nube, o el operador apunta a otro sitio | `tcpdump` filtrando por las redes del SBC, sin filtro de puerto | Regla de ingreso UDP 5060 con el rango en **Destination**; o corregir el destino en el panel del operador |
| Llega el `INVITE` y responde `403` | El `identify` de la troncal no reconoce la IP del SBC | `pjsip show endpoints`, mirar los `Match:` | Corregir las redes del SBC en la troncal |
| Asterisk no arranca o la troncal no existe | Un CIDR inválido tumba el módulo pjsip entero | El log al arrancar | Corregir el CIDR en FALCON y volver a aplicar |
| `queue show` no existe | `aplicar.sh` se armó sin la troncal | Ver si `pjsip-troncal.conf` está en el servidor | Volver a aplicar |

### 10.2. Entra, timbra, y nadie contesta

| Síntoma | Causa | Qué se mide | Arreglo |
|---|---|---|---|
| `180 Ringing` y luego `CANCEL` | Ningún softphone registrado | `pjsip show endpoints`: todos `Unavailable` | Sección 8.4 |
| El softphone no se registra | La dirección WSS está tecleada a mano en «Configuración e integraciones» y no coincide | Comparar con `wss://<nombre>/ws` | Dejar que la planta escriba `config_pbx`; volver a aplicar |
| El softphone no se registra, y `curl` da 502 | `ipInterna` equivocada: nginx se habla a sí mismo | Comprobación 6.3 | Poner la IP del puente de Docker |
| El softphone no se registra, y el navegador se queja del certificado | Certificado no público | `openssl x509 -issuer` | Sección 4 |
| Registro en 403 sin explicación | `chan_sip` cargado | `module show like chan_sip` | El `noload` va **dentro** de `[modules]` |

### 10.3. Contesta y no se oye nada

Esta es la familia que costó la noche. Todas dan el mismo síntoma.

| Síntoma | Causa | Qué se mide | Arreglo |
|---|---|---|---|
| Sin audio, `ss` muestra un socket en `127.0.0.1` | **Asterisk hereda la dirección del transporte del WebSocket para abrir el RTP** | `sudo ss -lunp \| grep asterisk` con la llamada activa | `ipPrivada` en FALCON. Genera `media_address` **y** `bind_rtp_to_media_address` |
| Sin audio, ICMP *port unreachable* en el `tcpdump` | Lo mismo de arriba: no hay socket en esa dirección | `tcpdump` sin filtro de puerto | Igual |
| Sin audio, el navegador solo ve candidatos `10.x` o `172.x` | NAT 1:1: la IP pública no está en ninguna interfaz | `chrome://webrtc-internals`, `remote-candidate` | `ipPrivada` + `ipPublica`: genera `[ice_host_candidates]` |
| Sin audio, el navegador ve el candidato público pero `0 responses` | Se anunció la pública **sustituyendo** la privada: Asterisk se quedó sin dirección local desde la que enviar | `Error sending STUN request: Invalid argument` en el log | `include_local_address`. Lo genera FALCON |
| Sin audio, el navegador ve cuatro o cinco candidatos `172.x` | El contenedor va en red host y Asterisk ve todos los puentes de Docker | `ip -4 addr show` | `ice_deny` de los rangos privados. Lo genera FALCON |
| Audio de una sola vía | `external_media_address` ausente: Asterisk anuncia la privada en el SDP de la troncal | El SDP en `pjsip set logger on` | `ipPublica` en FALCON |
| La llamada entra, timbra, se contesta y Asterisk la cuelga él solo | Opus antes que ulaw: *Unable to find a codec translation path* | El log | `allow = ulaw,alaw`. Lo genera FALCON |

### 10.4. La troncal figura caída, pero las llamadas SÍ entran

Esta familia se reconoce por una contradicción: el ciudadano llama y la llamada
entra con audio en los dos sentidos, y al mismo tiempo el panel dice que la
troncal está mal y el botón «Llamar» del caso no marca.

No es una contradicción. Son dos caminos distintos que no comparten nada:

- **Lo entrante** llega por el `identify` por IP, que mira la dirección de
  origen del `INVITE` y **no mira el estado del contacto para nada**.
- **Lo saliente y el `qualify`** usan el `contact` del AOR. Si ese contacto no
  se puede resolver, los dos se rompen a la vez y lo entrante ni se entera.

Con autenticación por IP no hay registro, así que el `qualify` es la única
señal de estado que existe. Cuando no sale, el contacto se queda en `Unavail`
**para siempre**, y leer eso como «no entran llamadas» es afirmar algo falso.

| Síntoma | Causa | Qué se mide | Arreglo |
|---|---|---|---|
| Troncal `Unavail` con llamadas entrando bien | El `contact` no resuelve: el operador publica el nombre por `SRV`, sin registro `A` | `dig @8.8.8.8 <nombre> A` **con cabecera, nunca `+short`**, y después `dig @8.8.8.8 _sip._udp.<nombre> SRV` | Poner en el campo *Servidor* de la troncal el host que nombra el `SRV`, con su puerto |
| Troncal `Unavail` y el `OPTIONS` saliente no obtiene respuesta | Falta la regla de salida, o nuestra IP no está declarada en el panel del operador | `tcpdump -n host <IP del SBC> and port 5060` mientras corre el `qualify` | Abrir la salida; declarar la IP del servidor en el panel del operador |
| El panel de monitoreo dice `troncal-sin-sondeo` | Es el aviso correcto, no una falla de FALCON: significa «no puedo sondearla», no «está caída» | Lo de arriba | Lo de arriba |

> **Un puerto explícito anula el `SRV`.** El generador escribe
> `contact = sip:<servidor>:<puerto>`, y según el RFC 3263 una URI con puerto
> salta directo a `A`/`AAAA` sin consultar `SRV`. Por eso el campo *Servidor*
> tiene que llevar el host **final** —el que el `SRV` nombra—, no el nombre de
> la troncal que entrega el operador.
>
> Visto con Infobip el 20 de octubre de 2026: el nombre de la cuenta
> (`6ad3…latam.sip.voice.infobip.com`) da `NXDOMAIN` en `A`, y su
> `_sip._udp` apunta a `clients-co2.sip.voice.infobip.com:5060`, que resuelve a
> la misma IP desde la que llegaban los `INVITE`. Con `dig +short` los dos
> casos —«no existe» y «no me responde el DNS»— se ven idénticos: vacío. Esa
> ambigüedad costó una conclusión equivocada. **Mida con cabecera y con un
> nombre de control.**

### 10.5. Problemas de la instalación

| Síntoma | Causa | Arreglo |
|---|---|---|
| `Package 'asterisk' has no installation candidate` | Imagen basada en Debian 12, que retiró el paquete | La imagen parte de `ubuntu:24.04` |
| ICE con comportamiento raro y Asterisk 18.10 | Versión anterior a varias correcciones | `ubuntu:24.04` trae Asterisk 20 LTS |
| La imagen no se reconstruye con los cambios | La etiqueta no cambió | La etiqueta es `falcon-pbx:2`; al cambiar la base hay que subirla |
| `Unable to open specified master config file` en cada comando | El volumen tapa el `/etc/asterisk` del paquete | FALCON genera `asterisk.conf` y `logger.conf` |
| La carpeta `log/` vacía | Sin `logger.conf`, Asterisk solo habla por consola | Igual |
| `aplicar.sh` aborta al recargar nginx | El 443 lo tiene otro servicio | El script lo detecta y avisa; sección 6.2 |
| El softphone deja de conectar sin que nadie toque nada | El certificado se renovó y el nginx lee de otra carpeta | El hook de la sección 4.1 |

---

## 11. Cuando no hay audio: el orden correcto de diagnóstico

**Esta sección existe porque el 19 de octubre se probaron cinco hipótesis
distintas antes de medir lo que había que medir.** La causa estaba visible desde
el principio en un comando de una línea.

La regla: **mida de abajo hacia arriba, y no pase al siguiente nivel hasta que
el anterior esté confirmado.** Cada nivel tiene una respuesta objetiva, no una
interpretación.

### Nivel 1 — ¿Existe el socket?

```bash
sudo ss -lunp | grep -i asterisk
```

Con una llamada contestada tiene que haber un socket por cada pata de audio, y
**ninguno en `127.0.0.1`**.

> Si falla aquí, no mire ICE, ni STUN, ni certificados, ni versiones de
> Asterisk. **Ninguno de esos puede funcionar si no hay socket.**

### Nivel 2 — ¿Llegan los paquetes al servidor?

```bash
sudo timeout 30 tcpdump -nni any 'udp portrange <rtpDesde>-<rtpHasta>'
```

- Nada → es cortafuegos o el otro extremo no manda.
- Llegan y aparece **`ICMP port unreachable`** → vuelva al nivel 1: el socket no
  está donde se anunció.

### Nivel 3 — ¿Sale algo del servidor?

En la misma captura, mire las líneas `Out`.

- Solo `In` → Asterisk recibe y no manda. Casi siempre es el nivel 1.
- `In` y `Out` → el audio fluye; si aun así no se oye, es códec o el navegador.

### Nivel 4 — ¿Qué direcciones se están anunciando?

En el navegador del operador, `chrome://webrtc-internals`, abierto **antes** de
la llamada. Mire los `remote-candidate`:

- Solo privadas (`10.x`, `172.x`) → falta el mapeo de NAT 1:1.
- La pública, pero `STUN requests sent: N / responses received: 0` → se anuncia
  bien y no hay con qué responder: vuelva al nivel 1.

Y del lado del servidor:

```bash
sudo docker exec asterisk-<instancia> asterisk -rx 'logger add channel /var/log/asterisk/diag debug,verbose,notice,warning,error'
sudo docker exec asterisk-<instancia> asterisk -rx 'core set debug 3'
#  ... hacer la llamada y contestarla ...
sudo docker exec asterisk-<instancia> asterisk -rx 'core set debug 0'
sudo docker exec asterisk-<instancia> asterisk -rx 'logger remove channel /var/log/asterisk/diag'
sudo grep -niE "ICE add candidate|ICE add remote|ICE complete" /opt/falcon-pbx/<instancia>/log/diag | tail -30
```

`ICE add candidate` dice **exactamente** qué direcciones armó Asterisk.

### Lo que NO hay que hacer

- **No cambie la versión de Asterisk sin haber medido el nivel 1.** Subimos de
  18.10 a 20 creyendo que era la causa. No lo era (aunque el cambio era bueno
  igual).
- **No persiga `Error sending STUN request: Invalid argument`.** Es un síntoma,
  y aparece también en llamadas que funcionan. Lo que no aparece en llamadas que
  funcionan es un socket en `127.0.0.1`.
- **No arregle a mano en el servidor sin llevarlo al generador el mismo día.**
  Los dos arreglos a mano de esa noche (el `Dockerfile` y el `media_address`)
  habrían desaparecido en el siguiente *Aplicar*.
- **No invente el nombre de una opción de configuración de memoria.** Dos de las
  vueltas perdidas fueron por eso: `ice_host_candidate` en `[general]` cuando es
  la sección `[ice_host_candidates]`, y `media_address` sin
  `bind_rtp_to_media_address`. El `rtp.conf.sample` y el `pjsip.conf.sample` de
  la versión que corre están a un `curl` de distancia:

  ```
  https://raw.githubusercontent.com/asterisk/asterisk/20/configs/samples/rtp.conf.sample
  https://raw.githubusercontent.com/asterisk/asterisk/20/configs/samples/pjsip.conf.sample
  ```

---

## 12. Lista de verificación, para imprimir

```
PREPARACIÓN
[ ] Cuatro datos del servidor recogidos (pública, privada, interna, DNS)
[ ] Puertos abiertos en la nube: UDP 5060, UDP <rtp>, TCP 443
[ ] Puertos abiertos en el host (si la política es restrictiva)
[ ] Registro DNS creado y resolviendo
[ ] Certificado emitido por una CA pública
[ ] Hook de renovación, si el nginx lee de otra carpeta

FALCON
[ ] Planta dada de alta, con las tres IP y el nombre
[ ] Troncal cargada, CIDR válidos
[ ] Número cargado, destino «cola»
[ ] «Qué le falta» vacío

INSTALACIÓN
[ ] nginx enganchado (y 6.3 da 101, sin -k)
[ ] aplicar.sh corrido, y borrado con shred

COMPROBACIÓN
[ ] 8.1  contenedor Up, versión sin avisos
[ ] 8.2  transportes correctos, chan_sip fuera
[ ] 8.3  extensiones y cola presentes
[ ] 8.4  el softphone pasa a «Not in use»
[ ] 8.5  ss: ningún socket en 127.0.0.1
[ ] 8.6  INVITE → 200 OK
[ ] 8.7  RTP con paquetes In Y Out
[ ] 8.8  la grabación aparece en el caso

CIERRE
[ ] API key rotada (otro Aplicar)
[ ] aplicar.sh borrado de todas partes
[ ] Datos del servidor anotados en «Notas» de la planta
```
