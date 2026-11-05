# Diagnóstico de AgroBot y correo — AgroValle

Fecha: 4 de noviembre de 2026 (America/Lima).

## Revisión actual: alertas y publicación comprobada

**Nuevo cambio local para UPDATE:** el usuario confirmó que recibió la alerta de
una fila nueva con temperatura alta y después habilitó UPDATE en el webhook de
Supabase. Esa confirmación procede del usuario, no de una prueba real adicional
del agente. Se adaptó localmente el receptor para alertar solo al pasar de <=30 a
>30, usando `old_record`. Para un nuevo cruce de la misma fila requiere versión
temporal nueva (`updated_at` o `fecha_hora` posterior), conservada en los reintentos;
sin ella rechaza el cruce sin enviar. INSERT y reportes conservan su comportamiento.
No se modificaron tabla, entorno privado ni producción. Ver `NOTIFICACIONES.md`
para el contrato y los límites. Este soporte no está desplegado todavía.
La suite final de esta ampliación aprobó **40 pruebas, 0 fallidas**; auditoría de
archivos versionables sin coincidencias sensibles detectadas. Evidencia ignorada:
`evidencia/pruebas-alertas-update.tap`. No se hicieron commits ni push.

**Estado más reciente:** tras el despliegue indicado por el usuario, la comprobación
sin autenticación del receptor a las 02:07:53 UTC respondió **401
`WEBHOOK_NO_AUTORIZADO`**. La ruta ya está disponible y exige autenticación. Esto
sustituye el 404 anterior; no confirma coincidencia del secreto con Supabase, modo
webhook, destinatario ni entrega Resend. No se insertaron lecturas ni enviaron
correos. Falta una prueba extremo a extremo expresamente autorizada.

Actualización posterior: el usuario indicó que creó el webhook de Supabase. La
comprobación del receptor público a las 02:05:49 UTC del 5 de noviembre (4 de
noviembre en Lima), con POST vacío y sin autenticación, volvió a responder 404.
El receptor aún no está disponible; sigue pendiente el despliegue de la corrección.
No se verificó el contenido del webhook ni se insertaron lecturas o enviaron correos.

Se revisaron todas las ramas disponibles tras consultar y descargar referencias de
GitHub: backend `main=9a8f938`, rama de trabajo `9265dce`; frontend `main=0941c9d`,
rama de trabajo `a2ef710`. La corrección de alertas está publicada en la rama de
trabajo del backend, pero todavía no está incluida en `main`. No se hicieron commits
ni push en esta revisión. Las referencias locales `main` no se movieron.

Render devolvió 404 `Cannot POST` al nuevo receptor con un cuerpo vacío y sin
autenticación. La ruta nueva no está disponible en la URL pública comprobada; el
usuario indicó que la rama de Render es `feat/resend-agrobot-release` y después
proporcionó el commit del deploy: **`9a8f938`**. Su árbol Git no incluye `alertas.js`
ni el nuevo receptor, lo que explica el 404. La corrección `9265dce` no está en ese
deploy. La rama y el SHA son información del usuario, sin inspección directa del
panel; el SHA identifica el merge anterior de `main`. Esto no identifica el emisor
del correo antiguo. No se invocaron endpoints de
envío ni escritura. No se consultó ni modificó Supabase.

El usuario informa cero triggers de usuario en `public.telemetria`, remitente Gmail
del compañero y ausencia de la alerta en Resend. No se encontró ese remitente en
los archivos históricos revisados, ni otro monitor automático en los repositorios.
El Gmail SMTP histórico solo alerta al pasar por Express. El origen del correo
anterior sigue sin identificar; no se atribuye a Render. La ausencia de triggers
de esa tabla no descarta consumidores o tareas externas.

Pruebas repetidas: **36/36 backend**, compilación y lint frontend correctos. La
separación de destinatarios, umbrales, Bearer, fuente exclusiva e idempotencia se
verificaron con simulaciones. Auditoría de archivos versionables: cero coincidencias
sensibles detectadas; `.env` ignorado. No se alteraron código, credenciales ni paneles.

Conclusiones, límites, archivos del commit y siguientes pasos en
[DIAGNOSTICO-ALERTAS.md](DIAGNOSTICO-ALERTAS.md) y
[PROPUESTA-COMMITS-Y-DESPLIEGUE.md](PROPUESTA-COMMITS-Y-DESPLIEGUE.md).
Las secciones siguientes conservan antecedentes de sesiones anteriores; sus frases
sobre cambios «sin commit» o «no publicados» describen aquel momento.

## Alertas automáticas: origen directo en Supabase y propuesta local

El usuario confirmó que las lecturas llegan directamente a Supabase y que Resend
solo registraba los reportes, no la alerta antigua. El código anterior solo evaluaba
temperatura dentro de `/api/telemetria`; los INSERT directos no ejecutan esa ruta.
Reportes y alertas de esa versión compartían transporte y `EMAIL_USER`, sin un
destinatario fijo del compañero ni un segundo mecanismo automático en estos repositorios.
El proceso externo que sigue enviando al compañero aún no está identificado. No hay
evidencia para atribuirlo a Render; falta inspeccionar triggers/webhooks, funciones,
cron y el emisor real con acceso administrativo. No se consultó ni cambió Supabase.

Se prepararon cambios locales sin commit: destinatarios `ALERT_EMAIL_TO` y
`REPORT_EMAIL_TO`, alertas Resend, HTML con contexto disponible y receptor autenticado
`/api/webhooks/supabase/telemetria`. Un modo exclusivo `ALERT_TRIGGER` evita alertar
desde Express y webhook a la vez. Las repeticiones de webhook usan la clave idempotente
del proveedor, con su ventana de 24 horas; no se promete deduplicación permanente.
Se mantuvieron el INSERT de telemetría y AgroBot. No se cambió `.env` ni producción.

Ver [DIAGNOSTICO-ALERTAS.md](DIAGNOSTICO-ALERTAS.md) para hallazgos, pruebas simuladas,
consultas opcionales de catálogo sin secretos y propuesta de configuración futura.
El usuario eliminó `.env.example` en el commit posterior `498498e`; se respetó esa
eliminación y se documentan los campos nuevos sin restaurar la plantilla.

La suite final aprobó 36 pruebas, 0 fallidas: 29 de regresión y 7 nuevas, incluyendo
los umbrales 29/30/35 en ambos modos. La prueba de duplicados verifica una fuente
exclusiva y una única aceptación del proveedor simulado al repetir la misma clave.

## Preparación para publicación en ramas independientes

El usuario confirmó aceptación de Resend y recepción en Gmail de la primera prueba
real. Durante esta preparación no se enviaron correos adicionales ni se escribieron
registros en Supabase. Se mantuvieron intactos los paneles de Render/Vercel.

Se crearon ramas locales independientes `feat/resend-agrobot-release` (backend) y
`feat/local-api-release` (frontend). El backend funcional quedó en `337fb2d`; el
frontend en `a2ef710`. Este diagnóstico y el plan forman parte del segundo commit
backend de herramientas/documentación. No se hizo push ni merge a `main`.

Se repitieron 29 pruebas aprobadas, build y lint correctos. También se compiló con
la URL real de Render y se comprobó que el bundle no incluye la API localhost.
La prueba de compatibilidad usó procesos recién iniciados en 43129/5174, Chrome real,
Supabase solo en lectura y correo en memoria: login, historial, AgroBot y reporte 200;
5 lecturas/tarjetas, cero envíos y cero escrituras.

El modelo predeterminado del código y la plantilla se actualizaron a
`gemini-3.5-flash-lite`. La plantilla de publicación selecciona `EMAIL_PROVIDER=resend`;
el proveedor SMTP sigue disponible si se elige o si falta la variable en instalaciones
anteriores. No se cambió `.env` ni la configuración de producción.

Se revisó cada conjunto staged antes de su commit para excluir secretos. Los archivos
`.env`, `.env.local`, `dist`, dependencias y evidencias locales no se incluyen. Se
añadió `evidencia/` a `.gitignore` para no publicar detalles del equipo o auditorías.
Los informes históricos referenciados abajo siguen disponibles localmente, no en Git.

Ver [PROPUESTA-COMMITS-Y-DESPLIEGUE.md](PROPUESTA-COMMITS-Y-DESPLIEGUE.md) para el
contenido de commits, variables manuales, orden de publicación y reversión.

## Migración de correo a Resend: implementación local para revisión

Se incorporó el SDK oficial `resend` 6.37.0, fijado con lockfile. `EMAIL_PROVIDER`
selecciona Resend por HTTPS o SMTP; sin la variable se conserva SMTP. Los endpoints,
HTML de reportes/alertas, consulta de últimas diez lecturas y umbral mayor de 30 °C
se mantienen. El transporte en memoria de validación local continúa sin envíos reales.

Las solicitudes solo pueden dirigirse al `EMAIL_USER` configurado. Se descartan
destinatarios, CC/BCC y opciones de sobre del llamador. Resend usa `EMAIL_FROM`
como remitente; la plantilla incluye `onboarding@resend.dev`, `RESEND_API_KEY`
y `RESEND_TIMEOUT_MS`. El remitente de prueba requiere el correo de la cuenta como
destinatario; esa asociación no se verificó con envíos reales.

Las respuestas y logs distinguen aceptación de entrega: Resend debe devolver ID;
la API informa `estado: aceptado` y `entrega: no_confirmada`. No se afirma entrega
por la sola aceptación ni se implementó un webhook de entrega. Hay timeout abortable,
clasificación de errores y logs sanitizados, sin reintentos ni fallback automático a SMTP.

Ejecución final: **29 pruebas aprobadas, 0 fallidas**, incluidas las 14 anteriores;
reporte en `evidencia/pruebas-resend.tap`.
Se simularon respuestas del servicio usando el SDK instalado y se probaron ambos
endpoints HTTP con Supabase simulado. No se enviaron correos reales, no se accedió a
Supabase en esta fase de migración, no se modificó producción y no hubo commits/push.
El diagnóstico sin flags confirmó presencia de configuración Resend local, sin
imprimir valores ni hacer peticiones de envío. `.env` no se modificó por el agente.

Se actualizó el CLI: `--smtp` siempre verifica SMTP; `--send-test` usa el proveedor
seleccionado y no depende de `EMAIL_PASS` al elegir Resend. No se ejecutó ese flag.
Ver [NOTIFICACIONES.md](NOTIFICACIONES.md) para variables de Render, contrato, errores,
límites de pruebas y pasos pendientes. Los registros de sesiones anteriores se conservan
abajo; la entrega Gmail confirmada en ellos corresponde a SMTP, no a Resend.

## Cierre del diagnóstico de red: conexión restablecida

4 de noviembre de 2026, aproximadamente 18:39–18:41 (America/Lima).
**Estado actual: la conexión Windows–Supabase funciona con las credenciales existentes,
SSL verificado y configuración predeterminada de Node.** Se completaron historial y
preparación del reporte desde React. Los apartados siguientes conservan el historial
de sesiones anteriores y no sustituyen esta conclusión actual.

No se modificaron credenciales, DNS, proxy, certificados, RLS, esquema ni registros.
No se desactivó SSL y no se enviaron correos nuevos. No se ejecutaron commits ni push.

### DNS, IP, HTTPS y certificados

| Capa | Resultado real |
| --- | --- |
| DNS de Windows y consulta A | Ambos devuelven las mismas dos IPv4: `104.18.38.10` y `172.64.149.246`; orden variable. No se detectó entrada del proyecto en `hosts`. |
| IPv6 | AAAA devuelve `ENODATA`. No hay destino IPv6 para este hostname; no se puede probar un handshake IPv6 contra él. La ausencia de AAAA no impide el acceso IPv4 confirmado. |
| TCP IPv4:443 | Conexión correcta en 17 ms. |
| TLS predeterminado | TLS 1.3, certificado autorizado, emisor Google Trust Services; vencimiento 22 de enero de 2027. |
| TLS limitado a 1.2 | Certificado autorizado y conexión correcta. No se necesitó fijar esta versión en la aplicación. |
| HTTPS con curl | Tanto modo entorno como directo IPv4: HTTP 401 sin clave, salida 0 y verificación SSL 0 (correcta); sin túnel proxy. |
| HTTPS con Node 24.21.0 | HTTP 401 sin clave tanto con opciones predeterminadas como con `--use-system-ca` y `--use-env-proxy`. Estos flags solo se usaron en procesos de diagnóstico. |
| Certificados de Node y Windows | 121 raíces integradas y 115 raíces de sistema reportadas. La configuración predeterminada validó la cadena; no se detectó necesidad de instalar CA adicional. |
| Controles HTTPS | `supabase.com` respondió 200 y el origen de Google respondió 404; ambos resultados confirman que se completó HTTPS. |

Esta aplicación usa la **Data API HTTPS en el puerto 443**, no una conexión PostgreSQL
directa al puerto 5432. Las limitaciones IPv6 y el complemento IPv4 del endpoint de
PostgreSQL no son una explicación del fallo observado en esta URL REST.
[Referencias de Supabase: Data API](https://supabase.com/docs/guides/api) y
[tipos de conexión](https://supabase.com/docs/guides/database/connecting-to-postgres).

### Proxy y diferencias del entorno de ejecución

La consola restringida del agente expone variables de proxy a loopback, puerto 9.
En cambio, el diagnóstico ejecutado fuera del sandbox no tiene `HTTP_PROXY`,
`HTTPS_PROXY` ni `ALL_PROXY`. No deben confundirse esas variables inyectadas en el
entorno restringido con una configuración del Windows del usuario.
La lectura de WinHTTP indicó acceso directo; la lectura inicial de WinINET indicó
proxy desactivado y ningún PAC configurado. No se cambió ninguno de estos ajustes.

Node admite optar por variables de proxy mediante `--use-env-proxy`, y certificados
del sistema mediante `--use-system-ca`. El hecho de que existan esas opciones no
demuestra que sean necesarias: en la prueba fuera del sandbox funcionó el modo
predeterminado. No se añadieron flags permanentes ni bibliotecas de proxy.
[Documentación oficial de Node](https://nodejs.org/learn/http/enterprise-network-configuration).

Los `ECONNRESET` y el fallo TLS de curl registrados anteriormente fueron reales,
incluido un intento anterior fuera del sandbox. Hoy no se reprodujeron en el diagnóstico
completo. Se confirma la recuperación; **la causa original no está demostrada**.
No se atribuye el fallo definitivamente a Windows, un proxy, el certificado o Supabase.
Si reaparece, ejecutar `node diagnostico-red-supabase.js` desde PowerShell normal y
comparar con `evidencia/red-supabase-windows.json`, preservando la evidencia anterior.

### Conectividad frente a autenticación y permisos

1. HTTP 401 en `/rest/v1/` **sin enviar clave** es el resultado esperado del control
   no autenticado y prueba que se completaron TCP/TLS/HTTP. No significa que la clave
   configurada en `.env` sea incorrecta.
2. Con el cliente Supabase y las credenciales locales existentes, `select` de las
   últimas 20 y de las últimas 10 lecturas devolvió HTTP 200 y 5 filas, en 298 y
   221 ms respectivamente. La clave usada tiene acceso de lectura a `telemetria`
   en estas consultas. No se comprobaron permisos de escritura ni de otras identidades.
3. Los fallos anteriores tenían estado del SDK 0, `fetch failed` y `ECONNRESET`,
   sin respuesta HTTP del proveedor. Ese conjunto era un fallo de transporte,
   no evidencia de 401/403, RLS o credenciales inválidas.

### Validación funcional después de la recuperación

- Chrome real: login 200, historial 200, 5 tarjetas de lecturas, dos consultas de
  AgroBot 200 y reporte 200; todas las solicitudes de la aplicación a la API local.
- AgroBot siguió usando temporalmente `gemini-3.5-flash-lite`; la configuración normal
  no se cambió. La consulta agrícola respondió humedad óptima 60%–80%.
- Esta vez el handler de reporte consultó **Supabase directamente**, sin el adaptador
  alternativo de la sesión anterior. Recuperó las 5 lecturas, preparó una tabla con
  temperatura/humedad/fecha y generó MIME de 898 bytes en memoria.
- La interfaz mostró `Reporte preparado para revisión; no se envió correo`.
  Cero conexiones SMTP de envío y cero escrituras en Supabase.
- La validación de Chrome terminó con `ok: true`, cero excepciones de ejecución y
  `reactConectadoAPILocal: true`. La suite de backend sigue siendo la de 14 pruebas
  aprobadas; en esta sesión no se cambió código de negocio ni se repitió innecesariamente.

Evidencias actuales: `evidencia/red-supabase-windows.json`,
`evidencia/supabase-windows.json`, `evidencia/validacion-windows.json` y
`evidencia/reporte-preparado-windows.json`. Se preservaron los fallos en
`evidencia/supabase-windows-fallo-anterior.json` y
`evidencia/validacion-windows-fallo-anterior.json`.
La captura actual está en `../.local/validacion-windows.png`, fuera de Git.

Se preparó [PROPUESTA-COMMITS-Y-DESPLIEGUE.md](PROPUESTA-COMMITS-Y-DESPLIEGUE.md)
con archivos agrupados por repositorio, orden de despliegue, comprobaciones y rollback.
La validación local permite preparar la actualización; siguen pendientes la autorización
de publicación, la elección del modelo de producción y resolver el transporte de correo
de Render Free. El manual real aún no está presente.

## Registro previo de validación Windows: conexión pendiente en esa sesión

Sesión del 4 de noviembre de 2026, aproximadamente 18:13–18:24 (America/Lima).
El usuario confirmó que el único correo enviado en la sesión anterior llegó a Gmail.
En esta sesión se realizaron **cero envíos reales**, cero escrituras en Supabase y
ningún commit, push o cambio de configuración de producción.

La validación completa está **pendiente de resolver la conexión directa de Windows a
Supabase**. Login, React/API local y AgroBot desde Chrome funcionan. No se presenta
el historial vacío como una consulta exitosa ni la prueba alternativa del reporte
como validación del acceso directo a Supabase.

| Comprobación | Resultado |
| --- | --- |
| Backend local | Iniciado en `http://127.0.0.1:3000` con `node local-validacion.js`. |
| Frontend local | Vite iniciado en `http://127.0.0.1:5173`; `.env.local` apunta a `http://127.0.0.1:3000`. Archivo ignorado por Git. |
| Login desde interfaz | Correcto, POST local 200 y preflight 204. No se registraron credenciales ni tokens. |
| React conectado a API local | Confirmado en Chrome real: todas las respuestas `/api/*` observadas procedieron de `http://127.0.0.1:3000`. |
| Gemini configurado | `.env` no define `GEMINI_MODEL`, por lo que el arranque normal usa `gemini-3.8-flash`. El arranque de validación fuerza únicamente en memoria `gemini-3.5-flash-lite`. |
| AgroBot desde interfaz | Las dos consultas devolvieron 200 y se mostraron sus respuestas en React. Humedad: 60%–80%. `manual.pdf` sigue ausente; se usa contexto alternativo. |
| Supabase directo desde Windows | DNS resuelve por IPv4; consultas `select` fallan antes de HTTP con `ECONNRESET`. El SDK registra estado 0 y la API local devuelve 500. |
| Contraste de conexión | `curl` sin credenciales contra el origen de Supabase falla con código 35 y HTTP 000 (error de negociación TLS). No se desactivó validación de certificados. |
| Historial publicado, solo lectura | GET a Render devuelve HTTP 200 y 5 registros existentes. No se publicaron sus valores en los logs. |
| Historial en interfaz local | No carga registros: el problema de conexión no permite verificar las tarjetas con datos reales. |
| Botón de reporte local | Se ejecutó desde Chrome; devuelve 500 al fallar la consulta de Supabase. No se alcanza la preparación MIME ni se envía correo. |
| Preparación aislada del reporte con lecturas existentes | Se consultaron las 5 lecturas mediante GET al historial publicado y se pasaron al mismo handler de reporte usando un adaptador de prueba de solo lectura. HTTP 200, MIME generado en memoria, cero envíos. Esta fuente alternativa no se incorporó como fallback de la aplicación. |
| Verificación de código | 14 pruebas de backend aprobadas; compilación Vite y ESLint correctos; `git diff --check` correcto en ambos repositorios. |
| Git y credenciales | Sin archivos staged. Escaneo de archivos versionables y staged sin coincidencias con los secretos locales ni los patrones revisados. `.env` y `.env.local` excluidos; plantillas sin valores secretos. |

### Límites de la causa de Supabase

El fallo directo se repitió fuera del sandbox. DNS correcto más `ECONNRESET` en Node
y código 35 en curl sitúan el bloqueo antes de recibir una respuesta HTTP del servicio.
No se obtuvo un 401/403 que permita atribuirlo a la clave o a políticas de la tabla.
Tampoco se confirmó el componente que corta la conexión. Revisar la red/VPN/proxy,
inspección HTTPS o firewall del equipo y contrastar privadamente que la URL del proyecto
local coincide con el proyecto usado por Render. El historial publicado disponible
no demuestra por sí solo que ambos entornos tengan idéntica configuración.

No se sustituyó la base de datos por datos inventados para hacer pasar la prueba.
La preparación alternativa del reporte usa registros reales recuperados mediante
la API pública existente y conserva explícitamente su origen en la evidencia.

### Arranque local para continuar

En terminales separadas, desde las carpetas indicadas:

```powershell
# Agrovalle/backend: modelo temporal, correo en memoria, escrituras bloqueadas
node local-validacion.js

# Agrovalle/frontend/frontend-react
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Se dejaron iniciados ambos servicios durante la validación. Si el entorno los termina,
usar los comandos anteriores. `local-validacion.js` solo escucha en loopback, permite
login/chatbot/reporte e historial y rechaza rutas de escritura como `/api/telemetria`.
El transporte es `streamTransport`: prepara el correo en memoria, nunca conecta SMTP.
El mensaje de la API distingue preparación local de aceptación por SMTP.
No usar `npm start` como sustituto para esta sesión: el arranque normal conserva el
transporte SMTP real.

Pruebas reproducibles desde backend:

```powershell
node verificar-windows.js
node verificar-supabase.js
node verificar-reporte-lecturas.js
node revisar-git.js
node --test
```

`verificar-windows.js` usa Chrome instalado en Windows mediante CDP, un perfil temporal,
credenciales locales en memoria y ninguna dependencia nueva. Cierra el navegador y
elimina el perfil de esa ejecución. Sus únicas peticiones de escritura son login,
chatbot y preparación del reporte en la API local; no invoca telemetría. Puede consumir
cuota de Gemini. La prueba devuelve error mientras historial/reporte directos fallen.

Evidencias: `evidencia/validacion-windows.json`, `evidencia/supabase-windows.json`,
`evidencia/historial-render-comparacion.json`, `evidencia/reporte-lecturas-render.json`
y `evidencia/revision-git.json`. Captura local: `../.local/validacion-windows.png`.
La captura y los perfiles temporales están fuera de ambos repositorios Git.

### Cambios pendientes de Git

Backend: modificados `.gitignore`, `diagnostico.js`, `index.js` y `package.json`.
Nuevos: `integraciones.js`, `local-validacion.js`, `.env.example`, documentación,
pruebas, probes y verificadores, además de evidencias sin credenciales. El cambio de
esta sesión en `index.js` permite distinguir un reporte preparado en memoria.

Frontend: modificados `frontend-react/src/App.jsx` y `frontend-react/.gitignore`;
nueva plantilla `frontend-react/.env.example`. Se corrigió un `catch` con variable
no utilizada para que ESLint pase y comentarios que aún decían que toda llamada iba a Render.

`frontend/package-lock.json` también está sin seguimiento: es un lockfile vacío en
la raíz, fuera de la aplicación `frontend-react`. No es necesario para desplegarla;
excluirlo del commit salvo que se decida convertir esa raíz en un paquete. No se borró.
Los archivos `.env.*` se ignoran en ambos proyectos, salvo `.env.example`.

La revisión busca los valores actuales de credenciales en archivos versionables,
el contenido staged y patrones comunes de claves. No es una auditoría del historial
completo de commits. No se añadieron archivos al índice ni se ejecutó push.

### Pendiente antes de desplegar

1. Resolver la conexión directa Windows–Supabase y repetir historial (20 últimas
   lecturas), tarjetas de React y reporte (10 últimas). Mantener el transporte de
   preparación para esa prueba; no hace falta insertar lecturas ni enviar correos.
2. Revisar/selectivamente añadir los cambios a cada repositorio por separado, manteniendo
   secretos, `.env.local`, `dist` y perfiles de navegador fuera de Git. GitHub aún no se actualizó.
3. Render: al autorizar despliegue, usar el backend normal (`npm start` / `node index.js`),
   no el arranque de validación. Configurar las variables de Supabase, JWT, administrador,
   Gemini y correo en el panel; verificar Node compatible con el entorno probado.
   Si se decide usar el modelo que funcionó, configurar `GEMINI_MODEL=gemini-3.5-flash-lite`
   en Render: la selección temporal local no se propaga por sí sola.
4. Render Free sigue bloqueando los puertos de Gmail SMTP. Elegir un entorno con SMTP
   permitido o un proveedor por HTTPS antes de esperar reportes/alertas publicados.
   La recepción correcta del correo desde Windows no resuelve esa limitación.
5. Vercel: raíz de proyecto `frontend-react` dentro del repositorio frontend;
   instalación `npm ci`, compilación `npm run build`, salida `dist`.
   Configurar `VITE_API_URL=https://agrovalle-backend-api.onrender.com` y recompilar.
   El `.env.local` de Windows no se sube; la compilación local actual incorpora la URL
   local y no debe reutilizarse como artefacto de producción.
6. Después del despliegue autorizado, repetir login, historial, CORS y AgroBot desde
   Vercel; coordinar aparte cualquier envío real de reporte o alerta. Si se requiere
   el contexto del manual real, asegurar su presencia en Render de forma apropiada.

## Actualización: pruebas reales con credenciales

Seguimiento del 4 de noviembre de 2026, aproximadamente 17:54–17:57 (America/Lima).
Esta actualización reemplaza el estado de credenciales vacías del registro inicial,
que se conserva más abajo para comparar resultados.

| Prueba real | Resultado observado |
| --- | --- |
| `node diagnostico.js --models --smtp` | Las tres credenciales están presentes, sin imprimir sus valores. El listado autenticado de Gemini funcionó y contiene `gemini-3.8-flash` con `generateContent`. Gmail confirmó conexión y autenticación SMTP correctas. Esta prueba no envió mensajes. |
| HTTP local, modelo configurado `gemini-3.8-flash` | Ambas preguntas devolvieron 502 `GEMINI_ERROR`, en 15150 y 25017 ms. CORS devolvió 204. |
| Diagnóstico directo del modelo configurado, límite 25 s | Se observó aborto de red y clase `GoogleGenerativeAIAbortError`, cuyo `name` real es `Error`. |
| Diagnóstico directo del modelo configurado, límite 60 s | Gemini respondió HTTP 503 después de 3037 ms; clase `GoogleGenerativeAIFetchError`. No se obtuvo texto generado. |
| Comparación directa temporal con `gemini-3.5-flash-lite` | Generación correcta en 2016 ms: humedad del 60% al 80%. |
| HTTP local temporal con `gemini-3.5-flash-lite` | Las dos preguntas devolvieron HTTP 200, en 1913 y 811 ms; OPTIONS 204. |
| `node diagnostico.js --send-test` | Se realizó un único envío, autorizado expresamente por el usuario, al mismo `EMAIL_USER`. Nodemailer confirmó aceptación por el servidor SMTP. Recepción en bandeja pendiente de confirmación. |
| Regresión tras corregir clasificación del timeout | `node --test`: 13 aprobadas, 0 fallidas. Supabase y entrega SMTP simulados en esta suite; no es un segundo envío real. |

### Respuestas reales de AgroBot por HTTP

Modelo temporal de prueba: `gemini-3.5-flash-lite`. Endpoint:
`http://127.0.0.1:43127/api/chatbot`. No se modificó el modelo del `.env`.

Pregunta: `Hola, responde brevemente.`

Respuesta:

> ¡Hola! Soy AgroBot, tu asistente del sistema AgroValle.
>
> Estoy listo para ayudarte con el monitoreo de temperatura, humedad y el control de riego. ¿Qué consulta tienes?

Pregunta: `¿Cuál es el rango óptimo de humedad según el manual?`

Respuesta:

> Según el Manual del sistema AgroValle, el rango óptimo de humedad es del **60% al 80%**.

`manual.pdf` continúa ausente: estas respuestas usan el texto alternativo de la aplicación,
no una extracción del manual técnico real. La mención del riego pertenece a la respuesta
generada; no se implementó ninguna funcionalidad adicional.

### Error encontrado y corrección mínima

El SDK antiguo instancia `GoogleGenerativeAIAbortError` sin cambiar `error.name`, que
permanece en `Error`. El clasificador revisaba únicamente `name`, por lo que el timeout
acababa como 502 genérico. Se añadió la comprobación `instanceof GoogleGenerativeAIAbortError`
en `integraciones.js` y una prueba con la clase real del SDK. Esta prueba confirma ahora
el contrato 504 `GEMINI_TIMEOUT`; no se presenta como una repetición HTTP real del timeout
después de la corrección.

Se añadió `--model=...` a `probe-http.js` para comparar modelos únicamente en el proceso
local y guardar evidencia por separado. No cambia `.env` ni admite esta selección en
las pruebas remotas.

El listado autenticado y las generaciones correctas con el otro modelo descartan una
ausencia de clave o un fallo general de autenticación para estas solicitudes. El modelo
original sigue sin producir respuesta en las pruebas realizadas; el 503 y el timeout
confirman fallos de generación, pero no prueban su causa interna (capacidad, disponibilidad
u otra condición del proveedor). No se observó un error de cuota 429 en estas pruebas.

### Correo único y límites respetados

- Destinatario: exclusivamente `EMAIL_USER`, autorizado mediante respuesta explícita.
  No se incluye la dirección ni ninguna credencial en este documento.
- Asunto: `AgroValle: prueba controlada de correo`.
- Contenido: mensaje fijo de diagnóstico, sin lecturas ni datos de Supabase.
- Resultado: comando terminado con código 0 y aceptación SMTP confirmada. No se reintentó
  el envío ni se invocaron `/api/reporte` o `/api/telemetria` contra servicios reales.
- Aceptación SMTP no demuestra llegada a la bandeja principal: revisar también spam.
- No hubo cambios en Render/Vercel ni escrituras en Supabase. Las pruebas de esta sesión
  fueron locales; el estado actual del despliegue no se volvió a medir.

### Evidencias y reproducción

- `evidencia/integraciones-reales.json`: resumen sin credenciales de autenticación,
  fallos del modelo, comparación y único envío.
- `evidencia/local-sin-credenciales.json`: copia conservada de la antigua respuesta 503.
- `evidencia/local-credenciales-inicial.json`: dos respuestas 502 con el modelo original.
- `evidencia/local-despues.json`: mismo resultado de la prueba inicial con credenciales.
- `evidencia/local-despues-gemini-3.5-flash-lite.json`: preguntas, respuestas y tiempos reales
  del modelo alternativo a través del endpoint local.

Para repetir autenticación y las consultas del modelo alternativo, sin enviar correo:

```powershell
node diagnostico.js --models --smtp
node probe-http.js --local --save --after --model=gemini-3.5-flash-lite
```

No volver a ejecutar `--send-test` como parte de esta sesión: el único envío autorizado
ya se realizó.

Pendiente: confirmar recepción del correo; decidir si se configura localmente
`GEMINI_MODEL=gemini-3.5-flash-lite` o se investiga la disponibilidad de `gemini-3.8-flash`;
comprobar el manual real cuando esté disponible. La selección alternativa aquí solo fue
temporal. SMTP correcto en Windows no elimina la restricción documentada de Render Free.
Cualquier despliegue o cambio de configuración de producción continúa pendiente de autorización.

## Estado observado en la sesión inicial

| Componente | Resultado | Alcance |
| --- | --- | --- |
| AgroBot local, código original | Las dos preguntas devolvieron HTTP 500 | Peticiones HTTP reales en Windows |
| AgroBot publicado en Render | Las dos preguntas devolvieron HTTP 500, mensaje genérico | Peticiones HTTP reales; no hay acceso a logs internos |
| AgroBot local, corregido | HTTP 503, `GEMINI_NO_CONFIGURADO` | La clave local continúa vacía; no se simula éxito |
| CORS local y Render | OPTIONS 204, origen `*`, POST permitido, `content-type` permitido | Origen solicitado: `https://agrovalle-frontend.vercel.app` |
| Frontend publicado | HTTP 200; bundle 200, con URL de Render y rutas de chatbot/reporte | Inspección del HTML y JavaScript públicos; sin sesión de navegador |
| Gmail SMTP desde Windows | Conexión y TLS correctos en 465 y 587 | Saludo SMTP, TLS y cierre; sin autenticación ni mensajes |
| Correo desde Render Free | Los puertos SMTP usados están bloqueados por la plataforma | Plan gratuito confirmado por el usuario; restricción documentada por Render |
| Reporte y alertas locales | Casos HTTP y generación MIME aprobados | Supabase y entrega SMTP simulados; ningún correo real |
| Frontend corregido | `npm.cmd run build` correcto | Vite 8.3.5; cambios solo locales |

No se insertaron registros en Supabase, no se enviaron correos reales y no se cambió producción.

## Inventario y causas

Backend: Express 5.3.0, `@google/generative-ai` 0.24.1, `pdf-parse` 2.4.5,
Nodemailer 10.3.1 y dotenv 18.0.9. Entorno actual: Windows, Node 24.21.0.
Frontend: React, Vite y Axios. Backend y frontend tienen repositorios Git separados.

### AgroBot

1. **Confirmado localmente:** `GEMINI_API_KEY` está vacía. El código anterior llamaba
   igualmente al proveedor y ocultaba el motivo detrás de HTTP 500. Una llamada directa
   del SDK con clave vacía recibió HTTP 403. No se dispone de una clave válida para
   comprobar permisos, cuota ni respuestas generadas.
2. **Incompatibilidad confirmada:** `require('pdf-parse')` devuelve un objeto en v2,
   pero el código lo invocaba como función de v1. Se reprodujo `TypeError: ... is not a function`.
   Esto fallaría al existir `manual.pdf`; actualmente no existe, por lo que esta rama no
   explica por sí sola el fallo local observado sin PDF.
3. **Diferencia de despliegue:** `manual.pdf` está ignorado por Git y no está versionado.
   No viajará a Render mediante el repositorio. El contexto alternativo es la ruta normal
   en este checkout; falta comprobar el manual técnico real, incluidos PDFs escaneados.
4. **Diagnóstico roto:** `diagnostico.js` importaba Axios, ausente en las dependencias del
   backend. Se confirmó `MODULE_NOT_FOUND`. Ahora usa `fetch` de Node y envía la clave en
   una cabecera, sin incorporarla a la URL.
5. **Modelo y SDK:** el modelo configurado originalmente, `gemini-3.8-flash`, figura en
   la documentación consultada. No se concluye que sea inexistente. Su disponibilidad para
   esta cuenta debe comprobarse con la clave real. Se verificaron `getGenerativeModel`,
   `generateContent` y `response.text()` con el SDK instalado y una respuesta de red simulada.
   Esto prueba el contrato del cliente, no compatibilidad real de esa cuenta/modelo.
   Google considera obsoleto el SDK antiguo y recomienda `@google/genai`; no se cambió
   la dependencia durante esta corrección mínima porque aún no hay un fallo atribuible
   al SDK en una solicitud autenticada.
6. **Producción: causa exacta pendiente.** No se conocen sus variables, versión de Node,
   versión desplegada ni logs de Gemini. Un HTTP 500 genérico no permite distinguir entre
   credencial inválida, permisos, cuota, acceso al modelo o problemas de contexto.

### Correo

1. **Configuración local incompleta:** `EMAIL_USER` y `EMAIL_PASS` están vacías.
   No se pudo verificar autenticación ni entrega. Gmail requiere configurar el mecanismo
   de autenticación apropiado; esta implementación espera una contraseña de aplicación.
2. **Restricción confirmada para el plan usado:** Render Free bloquea tráfico saliente
   a 25, 465 y 587. El código original usa el servicio Gmail de Nodemailer; utiliza SMTP
   en un puerto bloqueado. Cambiar entre 465 y 587 no resuelve esa restricción.
   Para conservar Gmail SMTP se necesita un entorno con salida SMTP permitida; otra
   alternativa es elegir un proveedor de correo con API HTTPS y adaptar el transporte.
   No se contrató un plan ni se incorporó un proveedor sin selección del usuario.
3. **Error de observabilidad confirmado por código:** la alerta registraba `Alerta enviada`
   independientemente del error de Nodemailer. El reporte devolvía un error genérico sin
   un registro útil. Se corrigieron ambos casos.
4. El reporte consulta las diez últimas lecturas. Las alertas conservan el criterio
   `temperatura > 30`; el registro de telemetría sigue respondiendo por el guardado,
   aunque falle la notificación asíncrona. El fallo de correo se registra por separado.

## Preguntas y respuestas registradas

| Pregunta | Local original | Render (segunda ejecución) | Local corregido sin clave |
| --- | --- | --- | --- |
| Hola, responde brevemente. | 500, 1534 ms | 500, 3014 ms | 503, 33 ms |
| ¿Cuál es el rango óptimo de humedad según el manual? | 500, 233 ms | 500, 21651 ms | 503, 6 ms |

Respuesta pública de error original, tanto local como en Render:
`{"ok":false,"error":"Error interno del servidor en la IA."}`.
Respuesta local corregida: `ok: false`, `codigo: GEMINI_NO_CONFIGURADO`,
`error: AgroBot no está configurado en el servidor.`

La primera consulta de una ejecución anterior contra Render agotó 45 segundos;
la segunda devolvió 500 en 11029 ms. Un nuevo intento produjo los dos 500 de la tabla.
No se atribuye el timeout a una causa concreta sin logs.
No se obtuvo ninguna respuesta agrícola real generada por Gemini.

Evidencias iniciales: `evidencia/local-antes.json`, `evidencia/render-antes.json`,
`evidencia/local-sin-credenciales.json`, `evidencia/vercel.json`, `evidencia/smtp-red-local.json`
y `evidencia/pruebas-locales.tap` (12 pruebas aprobadas, 0 fallidas).
El archivo de Render conserva la segunda ejecución. Cada ejecución vuelve a escribir
su archivo; copiarlo si se necesita conservar un histórico adicional.

## Correcciones locales

- `integraciones.js`: API v2 del parser, liberación del parser y contexto alternativo
  para PDF ausente, corrupto o sin texto. Se limita el contexto a 15000 caracteres.
- AgroBot valida la pregunta, permite `GEMINI_MODEL` y limita la solicitud a 25 segundos.
  Distingue configuración ausente (503), rechazo del proveedor (502), cuota (503),
  timeout (504) y respuesta vacía (502). Logs con códigos controlados y estados;
  no se vuelcan errores completos, cabeceras ni claves.
- `.env` se carga desde la carpeta del backend, independientemente del directorio
  desde el que se ejecute Node. Las variables externas siguen teniendo precedencia.
- SMTP permite host/puerto configurables, con TLS directo en 465 y STARTTLS obligatorio
  en otros puertos. Se añadieron límites de conexión y respuesta sin desactivar certificados.
- Se espera la aceptación del reporte y se comprueban destinatarios aceptados/rechazados.
  La alerta solo registra aceptación si el transporte respondió correctamente.
  El destinatario de todas las notificaciones permanece fijado a `EMAIL_USER`.
- El frontend acepta `VITE_API_URL`, conserva Render como valor predeterminado,
  muestra los mensajes públicos del backend y desactiva botones durante una solicitud.
  El timeout de 60 segundos puede mostrar errores de red si Render tarda más en arrancar.
- Se añadieron plantillas `.env.example`, scripts de diagnóstico, probes HTTP y pruebas.
  No se incluyeron credenciales ni se cambió el `.env` que completa el usuario.

## Repetición de pruebas

Desde `Agrovalle/backend`:

```powershell
node --test
node diagnostico.js --models --smtp
node diagnostico.js --smtp-network
node probe-http.js --local --save --after
node probe-frontend.js
```

`--models --smtp` omite las integraciones cuyas credenciales estén vacías.
`--smtp-network` comprueba solo conectividad/TLS con Gmail: no autentica ni envía.
`probe-http.js --local` inicia y detiene un backend en el puerto 43127; envía dos preguntas
al endpoint real. Con clave configurada, esas solicitudes usan Gemini y pueden consumir cuota.

Para repetir solo las dos consultas y CORS del despliegue:

```powershell
node probe-http.js --save
```

Las pruebas automatizadas verifican HTTP, validación de entradas, CORS, errores del
proveedor, PDF real sintético (válido, vacío, corrupto y ausente), contrato del SDK
simulado, MIME de reporte, umbral 30/31, fallos de correo, TLS y destinatario fijo.
Supabase está simulado en todas las pruebas de alertas y reportes.
El entorno restringido bloqueó inicialmente algunos procesos hijos (`spawn EPERM`);
se repitieron con permiso. Eso no se atribuye a la aplicación.

Desde `Agrovalle/frontend/frontend-react`:

```powershell
npm.cmd run build
```

## Configuración y pruebas pendientes del registro inicial

El estado actual de estos puntos está en la actualización al inicio del documento;
las credenciales y las pruebas de autenticación y envío ya se completaron en esta sesión.

1. Completar `GEMINI_API_KEY`, `EMAIL_USER` y `EMAIL_PASS` directamente en `backend/.env`.
   No pegar valores en el chat. Usar `.env.example` como referencia de los campos opcionales
   `GEMINI_MODEL`, `SMTP_HOST` y `SMTP_PORT`. No reemplazar el `.env` ya completado.
2. Ejecutar `node diagnostico.js --models`: verificar acceso del proyecto a
   `gemini-3.8-flash` y soporte de `generateContent`; elegir un modelo accesible si corresponde.
   Repetir las dos preguntas HTTP para obtener respuestas reales y revisar cuota/permisos.
3. Ejecutar `node diagnostico.js --smtp`: verifica autenticación sin enviar correos.
   Cuando se decida realizar la entrega real, `node diagnostico.js --send-test` envía
   un único mensaje a `EMAIL_USER`, sin consultar ni modificar Supabase. Confirmar recepción
   en la bandeja: aceptación SMTP no equivale a entrega final.
4. Resolver la salida de correo de Render mediante un entorno con SMTP permitido o
   un proveedor HTTPS elegido. Las correcciones de código no eliminan el bloqueo del plan.
5. Antes de desplegar, revisar en Render las variables de Gemini/correo, el acceso al modelo,
   la versión de Node compatible con `pdf-parse` (Node 24 local funcionó) y sus logs.
   El código ya escucha en `0.0.0.0` y respeta `PORT`, como requiere Render.
   Para usar el manual real debe existir en el despliegue; si contiene información privada,
   no retirarlo de `.gitignore` para publicarlo sin evaluar su contenido.
6. Para pruebas locales del frontend copiar su `.env.example` a `.env.local`.
   En Vercel usar `VITE_API_URL=https://agrovalle-backend-api.onrender.com` y recompilar
   cuando se autorice el despliegue. Las variables `VITE_` son públicas: no colocar secretos.
7. Después de desplegar cambios autorizados, repetir AgroBot y CORS en Render y probar
   los botones en una sesión de navegador. El reporte real y una alerta real con lectura
   existente requieren una prueba coordinada; no se fabricó telemetría en producción.

## Fuentes oficiales consultadas

- [Render: limitaciones de servicios gratuitos](https://render.com/docs/free).
- [Render: bloqueo de SMTP desde septiembre de 2025](https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports).
- [Render: puerto y host del servidor](https://render.com/docs/web-services).
- [Google: modelos Gemini](https://ai.google.dev/gemini-api/docs/models).
- [Google: estado de bibliotecas y migración](https://ai.google.dev/gemini-api/docs/libraries).
- [Google: diagnóstico de errores](https://ai.google.dev/gemini-api/docs/troubleshooting).
- [Nodemailer: opciones SMTP y verify](https://nodemailer.com/smtp).
- `node_modules/pdf-parse/README.md` y declaraciones de tipos del SDK instalado: referencias
  locales de las versiones efectivamente probadas.
