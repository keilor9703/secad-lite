# Montar la planta propia en el servidor B, paso a paso

> De lo que hay hoy —Asterisk instalado a mano, SIP en el 3478 porque no se
> podían abrir puertos— a la planta por instancia que FALCON provisiona.
>
> Escrito el 19/10/2026, cuando ya hay acceso a la consola de Oracle del
> servidor B (`129.80.243.118`).
>
> **El código ya está. Esto es solo el montaje.** Son nueve pasos; cuatro se
> hacen en un navegador (Oracle, el DNS, FALCON, Infobip) y cinco en la
> terminal del servidor.

---

## Lo que vas a tener al final

| Hoy | Al terminar |
|---|---|
| Asterisk del sistema, configurado a mano | Un contenedor por instancia, configuración generada por FALCON |
| SIP en el 3478 (puerto prestado a coturn) | SIP en el 5060, el que corresponde |
| El softphone entra por `wss://…:8089` | Entra por `wss://demo-pbx.falconcad.com.co/ws`, puerto 443 |
| Sin grabación | Graba y la sube al caso |
| Un operador | Cola de operadores |
| Contestar tarda ~1,5 s | Inmediato (paso 9) |

Dar de alta el siguiente municipio, después de esto, son **tres pasos**: un
registro DNS, un certificado y «Aplicar» en FALCON.

---

## Paso 0 · Reconocimiento (2 minutos, no cambia nada)

En el servidor:

```bash
ssh -i "C:\Users\acer\Downloads\ssh-key-2026-08-17.key" ubuntu@129.80.243.118
```

```bash
# ¿Quién tiene el 80 y el 443? ¿Y está libre el 8100 que va a usar la planta?
sudo ss -lntp | grep -E ':(80|443|8100|8088|8089)\b'
# ¿Hay nginx del sistema, con sites-enabled?
nginx -v 2>&1; ls /etc/nginx/sites-enabled 2>/dev/null
# ¿Docker?
docker --version
# ¿Qué reglas tiene el cortafuegos del host?
sudo iptables -L INPUT -n --line-numbers | head -20
```

Guarda esa salida. Dos cosas que decide:

- **Si no hay nginx del sistema** (porque SECAD lo sirve desde un
  contenedor), el `aplicar.sh` del paso 7 avisará y hay que enlazar el sitio a
  mano dentro de ese nginx. Dímelo y te doy el bloque exacto.
- **Si el 8100 está ocupado**, en el paso 5 cambia el puerto de HTTP/ARI de la
  planta en la pantalla de FALCON antes de aplicar.

---

## Paso 1 · Abrir los puertos en la consola de Oracle

**Donde:** consola de OCI → menú ☰ → **Networking** → **Virtual cloud
networks** → la VCN del servidor B → **Subnets** → la subred → **Security
Lists** → la lista (normalmente *Default Security List for …*) → pestaña
**Ingress Rules** → botón **Add Ingress Rules**.

Agrega estas reglas. En todas: *Stateless* = **No**, *Source Type* = **CIDR**,
*Source Port Range* = vacío (todos).

| # | Source CIDR | Protocolo | Destination Port Range | Para qué |
|---|---|---|---|---|
| 1 | `81.23.252.0/24` | UDP | `5060` | SIP de Infobip |
| 2 | `81.23.253.0/24` | UDP | `5060` | SIP de Infobip (su otra subred) |
| 3 | `0.0.0.0/0` | UDP | `20500-20999` | El audio (RTP) de esta planta |
| 4 | `0.0.0.0/0` | TCP | `443` | El softphone, por nginx |
| 5 | `0.0.0.0/0` | TCP | `80` | Certbot, para emitir y renovar |
| 6 | `0.0.0.0/0` | UDP | `49152-49252` | Relevo de coturn (ver paso 9) |

Dos decisiones de esa tabla:

- **El SIP solo desde las subredes de Infobip**, no desde todo internet. Un
  puerto SIP abierto al mundo recibe barridos de robots en horas, buscando
  cursar llamadas a tu costa. Asterisk ya lo filtra con su `identify`, pero
  que no llegue ni al proceso es mejor. **Si algún día agregas otra troncal,
  hay que agregar aquí sus subredes.**
- **El RTP sí desde cualquier parte**: el audio viene del navegador de cada
  operador (una IP distinta cada vez) y de los servidores de medios del
  operador telefónico, que no son los mismos del SIP.

Las reglas 4 y 5 puede que ya existan: si ya ves 443 y 80 en la lista, no las
dupliques.

---

## Paso 2 · Abrir los mismos puertos en el host

La consola de Oracle es **la primera de dos puertas**. La imagen de Ubuntu de
OCI trae su propio cortafuegos que descarta todo menos el 22, y eso es lo que
hace que un puerto «abierto» en la consola siga sin responder. Es el error que
cuesta una tarde.

```bash
sudo iptables -I INPUT -p udp --dport 5060 -j ACCEPT
sudo iptables -I INPUT -p udp --dport 20500:20999 -j ACCEPT
sudo iptables -I INPUT -p udp --dport 49152:49252 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT

# Que sobrevivan al reinicio. Si falta el paquete:
#   sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save
```

Comprobar que quedaron **antes** de la regla de rechazo:

```bash
sudo iptables -L INPUT -n --line-numbers | head -20
```

---

## Paso 3 · El nombre DNS

> **En el servidor B esto YA ESTÁ.** `centralita.appjeylor.com` resuelve a esa
> máquina y tiene certificado válido (`sudo certbot certificates` lo confirma).
> Usa ese nombre al registrar la planta y sáltate los pasos 3 y 4. Lo que sigue
> es para el PRÓXIMO municipio.


**Qué es:** un registro que hace que `demo-pbx.falconcad.com.co` apunte al
servidor B. Lo necesita el navegador del operador para llegar a *esta* planta
y no a otra, y lo necesita el certificado del paso 4.

**Dónde:** en el panel donde administras el DNS de `falconcad.com.co` — el
mismo donde está el registro que hoy apunta a producción. Si no recuerdas cuál
es, desde tu PC (PowerShell):

```powershell
nslookup -type=NS falconcad.com.co
```

Lo que responda te dice el proveedor: `*.cloudflare.com` → Cloudflare;
`*.domaincontrol.com` → GoDaddy; `ns1.<tuhosting>` → el panel de ese hosting.

**Qué crear ahí:**

| Campo | Valor |
|---|---|
| Tipo | `A` |
| Nombre / Host | `demo-pbx` (algunos paneles piden el nombre completo) |
| Valor / Apunta a | `129.80.243.118` |
| TTL | 300 (5 minutos) |

Comprobar, desde tu PC, hasta que responda la IP del servidor B:

```powershell
nslookup demo-pbx.falconcad.com.co
```

> Si Cloudflare es el proveedor: pon la nube **gris** (DNS only), no naranja.
> El proxy de Cloudflare no pasa WebSocket SIP ni, mucho menos, el audio.

---

## Paso 4 · El certificado

Una sola orden, en el servidor. El nombre tiene que resolver ya (paso 3) y el
80 tiene que estar abierto (pasos 1 y 2):

```bash
sudo certbot certonly --nginx -d demo-pbx.falconcad.com.co
```

Queda en `/etc/letsencrypt/live/demo-pbx.falconcad.com.co/` y se renueva solo.
Comprobar:

```bash
sudo ls -l /etc/letsencrypt/live/demo-pbx.falconcad.com.co/
```

> **Por qué un certificado por nombre y no un comodín `*.falconcad.com.co`:**
> Let's Encrypt solo emite comodines validando por DNS, o sea configurando la
> API del proveedor de DNS. Para uno o tres municipios no se paga esa
> complicación; cuando sean diez, se emite el comodín una vez y se cambian las
> dos líneas del `ssl_certificate`. La orden de arriba es una por municipio y
> se renueva sola.
>
> Si `--nginx` falla porque no hay nginx del sistema:
> `sudo certbot certonly --webroot -w /var/www/html -d demo-pbx.falconcad.com.co`

---

## Paso 5 · Registrar la planta en FALCON

En FALCON, como superadmin: **Plataforma → Nuestras centralitas**.

1. **Dar de alta**: instancia `demo`, servidor `129.80.243.118`. El nombre se
   deriva (`demo-pbx.falconcad.com.co`) y los puertos se reservan solos: SIP
   5060, RTP 20500–20999, HTTP 8100. (Si el paso 0 mostró el 8100 ocupado,
   ábrela y usa «Editar los puertos».)
2. **La troncal**: nombre `Infobip Bogotá`, operador `INFOBIP`, servidor
   `6ad3a3fbd3697b9b534eea6f907d.latam.sip.voice.infobip.com`, puerto `5060`,
   autenticación **por IP**, y en subredes del SBC:
   `81.23.252.0/24, 81.23.253.0/24`. Canales 10.
3. **El número**: `+18335308128`, tipo DID, destino `cola`.
4. Revisa la lista **«Para que esta planta atienda una llamada falta:»** hasta
   que quede vacía. Si dice que falta la clave SIP de los operadores, no hagas
   nada: se genera al aplicar.
5. **Ver la configuración** y léela. No toca nada.
6. **Aplicar**. Descarga `aplicar.sh`.

> Aplicar **renueva la API key de la instancia**. Desde ese momento y hasta que
> instales los archivos (paso 7), la central vieja no puede avisar a FALCON:
> las llamadas timbrarían en el teléfono y no aparecerían en la cola. Haz los
> pasos 6 y 7 seguidos.

---

## Paso 6 · Decirle a Infobip el puerto nuevo

En el panel de Infobip → **Troncales SIP** → tu troncal → **Host de destino**:
cambia el puerto de `3478` a **`5060`** (la IP sigue siendo la misma).

---

## Paso 6.5 · Si el 443 lo tiene otro servicio (el caso del servidor B)

En el servidor B el 443 no lo tiene el nginx del sistema —que está detenido—
sino el contenedor `falcon-deploy-nginx-1`, el del FALCON de pruebas que vive
en esa misma máquina. `aplicar.sh` lo detecta, no enlaza nada y lo dice; la
planta queda atendiendo la troncal igual, y lo que falta es el camino del
navegador.

Para engancharlo, después del paso 7:

```bash
# ¿Ese nginx ve el certificado y la configuración desde el host?
docker inspect falcon-deploy-nginx-1 --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}
{{end}}'
```

- **Si ya monta `/etc/letsencrypt`** y algún directorio de configuración
  (`conf.d`, `sites-enabled`), copia ahí el sitio generado y recarga:

  ```bash
  sudo cp /opt/falcon-pbx/demo/nginx/centralita.appjeylor.com.conf <el directorio montado>/
  docker exec falcon-deploy-nginx-1 nginx -t && docker exec falcon-deploy-nginx-1 nginx -s reload
  ```

- **Si no monta el certificado**, agrégale los dos volúmenes en
  `~/falcon-deploy/docker-compose.yml`, servicio `nginx`:

  ```yaml
      volumes:
        - /etc/letsencrypt:/etc/letsencrypt:ro
        - ./nginx/conf.d:/etc/nginx/conf.d:ro
  ```

  y recréalo: `cd ~/falcon-deploy && docker compose up -d --no-deps nginx`.

El contenedor tiene que poder alcanzar `127.0.0.1:8100` del **host**. Si corre
en red bridge, en el `proxy_pass` del sitio generado cambia `127.0.0.1` por
`host.docker.internal` y agrégale al servicio:

```yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

---

## Paso 7 · Apagar el Asterisk a mano y aplicar

El contenedor necesita el 5060 y el nombre; el Asterisk del sistema ya no va a
usarse. **No lo desinstales** —si algo sale mal, volver es encenderlo.

```bash
sudo systemctl disable --now asterisk
```

Lleva el script y córrelo:

```powershell
# desde tu PC, en la carpeta donde descargaste aplicar.sh
scp -i "C:\Users\acer\Downloads\ssh-key-2026-08-17.key" aplicar.sh ubuntu@129.80.243.118:/tmp/
```

```bash
sudo bash /tmp/aplicar.sh && shred -u /tmp/aplicar.sh
```

Escribe los archivos en `/opt/falcon-pbx/demo/`, construye la imagen la
primera vez (unos minutos), enlaza el sitio de nginx, lo **prueba** antes de
recargar, levanta el contenedor y comprueba transportes, troncal y cola.
Lleva todas las claves de la planta dentro: por eso se borra al terminar.

---

## Paso 8 · Probar

```bash
# ¿La troncal está viva? Debe decir «Avail» y un RTT.
docker exec asterisk-demo asterisk -rx 'pjsip show aors'
# ¿El puerto SIP es el 5060?
docker exec asterisk-demo asterisk -rx 'pjsip show transports'
```

En FALCON, con un operador que tenga extensión: **Encender** la barra. Debe
quedar «registrado». Luego llama desde tu celular al `+1 833 530 8128`:

1. la barra timbra y suena;
2. al oprimir **Contestar** dice «Contestando…» y conecta;
3. se oye por los dos lados;
4. el número aparece en Recepción, sin volver a oprimir nada;
5. al colgar, en el caso aparece **«Grabación de la llamada»**.

---

## Paso 9 · Devolverle el 3478 a coturn y abrir el relevo

Esto es lo que quita el último segundo y medio de espera al contestar, y
arregla de paso la videollamada en redes móviles.

```bash
# El 3478 vuelve a ser de coturn (ya no lo usa SIP).
sudo grep -n '^listening-port' /etc/turnserver.conf
sudo systemctl restart coturn
sudo ss -lnup | grep 3478
```

El rango de relevo (`49152-49252`) ya quedó abierto en los pasos 1 y 2. Para
comprobar que el relevo **relevó** de verdad, durante una llamada abre
`chrome://webrtc-internals` y busca un candidato `relay`.

Cuando eso funcione, la recolección de candidatos ICE termina en
milisegundos y el tope de 1500 ms deja de notarse: es un techo, no un retardo.

---

## Si algo falla, en este orden

| Síntoma | Dónde mirar |
|---|---|
| `Package 'asterisk' has no installation candidate` al construir la imagen | El Dockerfile parte de Debian: Debian 12 retiró ese paquete. Vuelve a aplicar desde FALCON para traer el corregido (Ubuntu 22.04), o corrige el `FROM` en `/opt/falcon-pbx/<instancia>/imagen/Dockerfile` y construye a mano |
| La llamada no entra | `docker logs asterisk-demo --tail 50`. Si no hay nada, el SIP no está llegando: revisa el puerto en Infobip (paso 6) y las reglas 1 y 2 |
| Entra pero no aparece en la cola de FALCON | La API key: ¿instalaste los archivos nuevos después de Aplicar? `docker exec asterisk-demo cat /etc/asterisk/falcon-webhook.conf` |
| El softphone no se registra | El nombre y el certificado: `curl -I https://demo-pbx.falconcad.com.co/ws`. Y que nginx haya recargado |
| Timbra, contesta y se cae | Códecs o ICE: `docker logs asterisk-demo --tail 80 \| grep -i codec` |
| Se oye solo de un lado | La IP pública de la planta en FALCON, y la regla 3 (RTP) |
| No aparece la grabación | `docker exec asterisk-demo cat /var/log/asterisk/falcon-grabaciones.log` |
