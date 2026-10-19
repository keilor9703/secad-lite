> ⚠ **Estas plantillas ya no son la fuente de verdad.**
>
> Desde el 19/10/2026 la configuración de cada planta la genera FALCON a
> partir de sus tablas (`backend/src/pbx/planta/generador.ts`), y se instala
> con el `aplicar.sh` que esa misma generación produce. Ver
> `docs/telefonia-planta-multitenant.md`.
>
> Lo de aquí se conserva como referencia del montaje manual —es lo que llevó a
> la primera llamada real de punta a punta— y porque los comentarios explican
> por qué cada línea dice lo que dice. Si edita algo aquí, no cambia ninguna
> planta.

# Plantillas de la centralita propia (Asterisk)

Para montar la **opción B**: troncal colombiana + Asterisk que operamos
nosotros, con la barra de FALCON contestando en el navegador. El plan completo
—fases, tiempos y las trampas— está en
[`../../docs/telefonia-asterisk-propio.md`](../../docs/telefonia-asterisk-propio.md).

Estos archivos **no se copian tal cual**: traen marcadores en MAYÚSCULAS que
hay que reemplazar. El script `instalar.sh` lo hace preguntando.

| Archivo | Para qué |
|---|---|
| `pjsip.conf.plantilla` | Transportes (WSS para los navegadores, UDP para la troncal), extensiones y troncal |
| `extensions.conf.plantilla` | El dialplan: timbrar al operador y avisarle a FALCON |
| `http.conf.plantilla` | El servidor web de Asterisk, que es quien sirve el WebSocket y ARI |
| `ari.conf.plantilla` | El usuario de la API con el que FALCON origina llamadas |
| `instalar.sh` | Reemplaza los marcadores y deja los archivos en `/etc/asterisk` |

## Lo que hay que tener antes

1. Un **subdominio** apuntando al servidor (`centralita.sudominio.com`), y en
   Cloudflare **en gris, sin proxy** — con la nube naranja el WebSocket no
   conecta y no hay mensaje que lo explique.
2. Un **certificado** de Let's Encrypt para ese nombre.
3. Los **dos cortafuegos** abiertos: la *Security List* de OCI **y** el
   `iptables` de la máquina. Olvidar el segundo es el error más común.
4. La **API key de la instancia** de FALCON (Plataforma → la instancia).

## Después de instalar

En FALCON, Plataforma → Planta telefónica → proveedor **Asterisk propio**, y
se pegan: la dirección `wss://`, el dominio, y —si se quiere el botón
«Llamar»— la URL de ARI con su usuario y clave. La clave de cada extensión se
registra por usuario en Administración, en el campo *clave SIP*.
