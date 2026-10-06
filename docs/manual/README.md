# Manual de usuario — fuentes

El entregable es `manual-usuario-falcon-cad.pdf`. Lo demás es lo necesario para
volver a generarlo cuando la interfaz cambie, para no tener que rehacer las
capturas a mano.

## Qué hay aquí

| Archivo | Qué es |
| --- | --- |
| `manual-usuario-falcon-cad.pdf` | El documento que se entrega a los municipios. |
| `manual.html`, `manual.css` | El fuente del PDF. El CSS es de impresión: lo que manda es `@page`. |
| `capturas/` | Las capturas del sistema, numeradas por capítulo. |
| `preparar.js` | Deja la base lista: `set_tenant`, RLS y la siembra DIVIPOLA. |
| `demo.js` | Siembra el municipio de demostración por la API. |
| `historial.js` | Agrega un mes de casos cerrados, para que el Panel y el Mapa tengan cuerpo. |
| `fechas.js` | Reparte las fechas: sin esto, toda la operación ocurre en el minuto del sembrado. |
| `capturar.js`, `recortar.js` | Toman las capturas con Playwright. |

## Cómo regenerarlo

1. **Base de datos.** Crear una base vacía y arrancar el backend una vez con
   `DB_SYNC=true DB_MIGRATE=false` para que `synchronize` cree el esquema.
   Pararlo y correr `node preparar.js`.

   El esquema **no** se crea corriendo las migraciones sobre una base vacía:
   `synchronize` produce el esquema final y las migraciones esperan el
   histórico, así que chocan. Por eso `preparar.js` aplica solo lo que las
   migraciones aportan y el esquema no: la función `set_tenant`, las políticas
   RLS y el catálogo DIVIPOLA.

2. **Datos.** Arrancar el backend (con `MFA_OBLIGATORIO=false` para poder
   automatizar) y correr, en orden: `demo.js`, `historial.js`, `fechas.js`.

   Un caso se despacha **con un recurso de su propia agencia**. El estado del
   caso se deriva de las bandejas por agencia, así que mandar una ambulancia a
   un caso de policía no mueve la bandeja de policía y el caso se queda en
   «nuevo».

3. **Capturas.** `node capturar.js` y `node recortar.js`. El segundo repite
   login y doble factor con una ventana ajustada: a tamaño completo la tarjeta
   queda diminuta en medio de un fondo vacío.

   La captura de doble factor exige el backend **sin** `MFA_OBLIGATORIO=false`.

4. **PDF.**

   ```
   chromium --headless --no-pdf-header-footer \
     --print-to-pdf=manual-usuario-falcon-cad.pdf \
     --virtual-time-budget=20000 manual.html
   ```

## Lo que falta

El fondo cartográfico del capítulo 7 sale en blanco: el entorno donde se
generó no tiene salida hacia el servidor de teselas. La figura 7.2 lo dice
explícitamente. Si se regenera desde un equipo con salida a internet, el mapa
sale completo y conviene quitar esa nota del `manual.html`.
