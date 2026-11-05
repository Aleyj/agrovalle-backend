# Alertas de temperatura: diagnóstico y preparación de publicación

Actualizado el 4 de noviembre de 2026 (America/Lima; evidencias UTC del 5 de noviembre).
La corrección ya está en GitHub en la rama de trabajo; todavía no está en `main`.
Durante esta revisión no se hicieron commits, push, despliegues, envíos de correo ni
consultas a Supabase. Las consultas SQL incluidas son propuestas, no se ejecutaron.

## Nueva evidencia y alcance de la investigación

**Avance posterior:** el usuario confirmó recepción de la alerta al insertar una
fila alta de un ESP. Luego habilitó UPDATE en el webhook. Se preparó soporte local
para cruces <=30→>30 con estado anterior y versión temporal única. Se mantienen
INSERT, reportes y la exclusividad de fuentes. Véase `NOTIFICACIONES.md`: no basta
con marcar UPDATE si Render aún ejecuta la versión que solo admite INSERT. No se
ejecutaron envíos ni ediciones reales en esta ampliación.

Validación de la ampliación UPDATE: **40 pruebas aprobadas, 0 fallidas**, incluidos
cuatro casos nuevos sobre cruces, reintentos, versiones y estados anteriores.
Evidencia: `evidencia/pruebas-alertas-update.tap`, ignorada por Git. La revisión de
archivos versionables no detectó coincidencias sensibles con los controles existentes.

- El usuario observó un correo con remitente Gmail de su compañero y asunto
  «Alerta: Temperatura crítica…», ausente de Resend. No se publica aquí su dirección.
  El campo From y un asunto parecido no identifican por sí solos el proceso emisor.
- El usuario ejecutó una consulta de triggers de usuario en `public.telemetria` y
  obtuvo cero registros. Si corresponde al mismo proyecto, tabla y momento del
  INSERT, esto contradice la hipótesis de un trigger de esa tabla o un Database
  Webhook instalado allí: estos webhooks se implementan mediante triggers.
  No descarta un proceso que consulte filas periódicamente, Realtime, Cron que
  invoque otro servicio o una automatización externa. No se verificó el catálogo
  directamente y no se afirma que exista ninguna de esas alternativas.
- Se consultaron las ramas vivas de GitHub con `git ls-remote --heads origin` y se
  actualizaron referencias mediante `git fetch origin`, sin cambiar de rama. Se
  revisaron los 7 commits alcanzables del backend y los 4 del frontend: 38 y 18
  blobs únicos de texto respectivamente, excluyendo binarios y lockfiles. La búsqueda
  cubrió remitente literal, asunto, SMTP/proveedores y señales de automatización.
  No hay coincidencias del remitente antiguo en esos archivos. No se revisaron
  repositorios ajenos, ramas eliminadas ni configuración privada de otros equipos.
- Los asuntos de temperatura crítica aparecen en `index.js` histórico y en
  `alertas.js` actual y sus tests. La semejanza no prueba quién envió el correo.
  Los commits `a39c21a` y `bf6ae0f` contienen Gmail SMTP; reportes y alertas toman
  el correo de variables privadas. Su alerta requiere una llamada a Express.
  Desde `337fb2d`, reportes y alertas compartían proveedor configurable hasta la
  separación actual. No se encontró otro emisor automático en el código revisado.
- No hay archivos de workflows, servicios programados, funciones Supabase ni cron
  en los árboles revisados. Los scripts locales de diagnóstico/envío son explícitos;
  no monitorean tablas. React solo consulta `/api/historial` cada cinco segundos,
  sin insertar filas ni enviar correo. Esto no permite descartar servicios externos.
- Se comprobó privadamente que `EMAIL_USER` y `EMAIL_FROM` locales no coinciden con
  el remitente antiguo. Las cuatro variables nuevas de alertas/destinatarios siguen
  sin definir en `.env`; no se alteró ese archivo ni se infiere la configuración remota.

**Conclusión:** no hay causa confirmada para el correo antiguo. Para identificarla,
correlacionar privadamente fecha, Message-ID y autenticación SPF/DKIM del mensaje
ya recibido con logs de servicios existentes. Revisar tareas del equipo emisor,
servicios anteriores, Cron, Edge Functions e integraciones externas con acceso del
propietario. No ejecutar envíos ni reenviar lecturas para investigar. Publicar esta
corrección no detendrá un emisor independiente y podría dejar dos sistemas activos.

## Publicación comprobada y respuesta de Render

**Última comprobación:** después de que el usuario indicó haber completado el
despliegue, el 2026-11-05 a las 02:07:53 UTC el POST vacío sin autenticación respondió
**401 `WEBHOOK_NO_AUTORIZADO`**. El receptor ya está disponible y rechaza peticiones
sin Bearer. En el código revisado esta respuesta implica un secreto configurado de
al menos 32 caracteres; no acredita que coincida con Supabase ni confirma el SHA
exacto, el modo de alertas, los destinatarios o la conectividad Resend. Los 404
descritos a continuación son observaciones anteriores. No se hicieron INSERT,
llamadas autenticadas al webhook ni envíos. La validación extremo a extremo sigue
pendiente y requiere autorización específica.

Actualización posterior: el usuario informó que ya creó el Database Webhook en
Supabase. No se inspeccionaron sus parámetros ni se ejecutó desde esta tarea. El
2026-11-05 a las 02:05:49 UTC se repitió la petición vacía y sin autenticación al
receptor público: sigue respondiendo **404, Cannot POST**. Por tanto, crear el
webhook no completó la activación: primero debe estar disponible el receptor en
Render. No se hicieron INSERT ni envíos de prueba. No generar lecturas de prueba
para validar esta configuración hasta resolver el despliegue y autorizar la prueba.

| Repositorio | Rama GitHub | Commit comprobado |
| --- | --- | --- |
| Backend | `feat/resend-agrobot-release` | `9265dce` — Alertas a nuevo correo |
| Backend | `main` | `9a8f938` — merge de la integración anterior de Resend/AgroBot |
| Frontend | `feat/local-api-release` | `a2ef710` |
| Frontend | `main` | `0941c9d` — merge del frontend anterior |

`9265dce` y `498498e` no son ancestros de `origin/main` del backend. Allí faltan
`alertas.js` y el receptor nuevo; la rama de trabajo sí los contiene. Las ramas
locales `main` siguen en sus bases antiguas; usar `origin/main` para comparar.

El 2026-11-05 a las 01:51:41 UTC (4 de noviembre, Lima) se hizo una sola petición
`POST https://agrovalle-backend-api.onrender.com/api/webhooks/supabase/telemetria`
sin Authorization y con cuerpo `{}`. Respondió **404, Cannot POST**. No se invocaron
`/api/telemetria` ni `/api/reporte`. El receptor revisado habría rechazado esa
petición con 401 o 503 antes de procesar eventos; no podía enviar ni escribir datos.
La ruta nueva no está disponible en la URL pública consultada. Esto es consistente
con una versión anterior, pero no identifica el SHA desplegado ni la rama del panel.
El usuario indicó después que Render utiliza `feat/resend-agrobot-release`
(normalización de su respuesta «feat/resend agrobot release» a la rama existente).
Posteriormente proporcionó el commit del deploy: **`9a8f938`**. Ambos datos proceden
del usuario, no de una inspección directa del panel. El árbol Git de `9a8f938`
corresponde al merge de la integración anterior; no contiene `alertas.js` ni el
nuevo receptor. Esto explica el 404 observado: la corrección `9265dce` todavía no
está en el código desplegado indicado. El SHA pertenece al merge de `main`; no
permite reconstruir por sí solo la rama configurada actualmente ni cómo se eligió
ese deploy. No hay acceso administrativo conectado. Esta diferencia de versiones
no identifica el origen del correo antiguo ni demuestra que Render lo envíe.

## Verificación repetida en esta revisión

- Backend: **36 pruebas aprobadas, 0 fallidas**, incluidas 29/30/35 °C,
  autenticación, destinatarios separados, duplicados y regresión de reportes.
- Frontend: `npm run build` y `npm run lint` correctos. No se repitió navegación
  real contra producción ni envíos; los endpoints se verificaron con dobles locales.
- `node revisar-git.js`: cero coincidencias con secretos/direcciones privadas locales
  y patrones comprobados en archivos versionables de ambos repositorios. `.env` y
  `.env.local` ignorados; nada staged. No es una auditoría exhaustiva de secretos históricos.
- Evidencia privada ignorada: `evidencia/origen-alertas.json`,
  `evidencia/pruebas-alertas-webhook.tap`, `evidencia/revision-git.json`.
- No se detectó un defecto que requiera cambiar código de las integraciones.
  Esta revisión actualiza documentación. La configuración y activación siguen pendientes.

## Revisión del flujo y antecedentes

1. **Origen de lecturas indicado por el usuario:** se insertan directamente en Supabase.
   También indicó que Resend registraba el reporte, no la alerta anterior. Esto es
   información aportada por el usuario; no una traza de red observada por el agente.
2. **Código anterior a esta corrección:** la alerta existía únicamente dentro de
   `POST /api/telemetria`, después del INSERT. Un INSERT realizado directamente en
   Supabase no ejecuta esa ruta ni activa esa condición de Express.
3. Reporte y alerta usaban una única instancia `crearCorreo(env)` y un único
   destinatario `EMAIL_USER`. Con `EMAIL_PROVIDER=resend`, ambas ramas de esa misma
   instancia usaban Resend. No había una selección SMTP especial exclusiva de alertas.
   Que reporte y alerta observados usen mecanismos distintos requiere contrastar
   el proceso y versión que realmente emite cada uno.
4. No se encontró en backend ni frontend un destinatario fijo del compañero, un
   scheduler, un receptor de Database Webhooks o una suscripción realtime que envíe
   alertas. El intervalo de React solo consulta historial cada cinco segundos.
   El frontend no publica telemetría en estos repositorios.
5. Nodemailer sigue como proveedor SMTP opcional en `integraciones.js`, como
   preparación MIME en memoria en `local-validacion.js` y en los tests. El CLI
   `diagnostico.js --send-test` puede enviar explícitamente, pero no se ejecuta como
   proceso de monitoreo ni fue invocado en esta sesión.
   La revisión del historial local también encontró Gmail SMTP en `a39c21a` y
   `bf6ae0f`, con destinatario tomado de variables de entorno, no un `to` literal.
   En `337fb2d` se introdujo la selección de proveedor compartida. Esto describe
   versiones locales; no demuestra qué versión corre en cada servicio remoto.
6. **Origen del correo antiguo: no identificado todavía.** Hay que inspeccionar
   triggers/webhooks/funciones/cron de Supabase, Edge Functions, servicios antiguos y
   el programa que inserta datos. Esos elementos no están definidos en el código local
   revisado y no hay acceso administrativo conectado a sus paneles desde esta tarea.
   No se atribuye la causa a Render ni se afirma que un cambio de backend detendrá
   un emisor externo. Desactivarlo requerirá identificarlo y autorizar ese cambio.

La configuración local tiene Resend seleccionado, pero no define actualmente
`ALERT_EMAIL_TO`, `REPORT_EMAIL_TO`, `ALERT_TRIGGER` ni `SUPABASE_WEBHOOK_SECRET`.
Solo se comprobó presencia, sin imprimir direcciones o secretos. El usuario eliminó
`.env.example` en el commit `498498e`; no se restauró ni se modificó `.env`.

## Corrección local para revisar

- Reportes: `REPORT_EMAIL_TO` independiente. Si falta la variable, se conserva
  `EMAIL_USER` para no cambiar el destinatario del reporte ya operativo. Una variable
  explícitamente vacía o una lista de direcciones se rechaza.
- Alertas: `ALERT_EMAIL_TO` obligatorio, sin fallback al correo antiguo de
  `EMAIL_USER`. Utilizan siempre el transporte Resend existente, incluso si SMTP
  está seleccionado para reportes. El remitente sigue siendo `EMAIL_FROM`.
- El llamador HTTP no puede elegir el tipo de correo, `to`, `from`, CC/BCC o sobre.
  El backend selecciona el propósito y el transporte impone el destinatario desde
  el entorno privado. `EMAIL_USER` conserva su función de autenticación SMTP.
- `alertas.js` centraliza la condición de temperatura, el HTML, la autenticación y
  la clave de idempotencia. El HTML conserva encabezado y temperatura destacados,
  añadiendo dispositivo, humedad y fecha cuando existen. Se escapan datos interpolados
  y no se inventa una fecha si falta. La fecha se normaliza a ISO para que una
  repetición del evento produzca el mismo contenido.
- No se cambió el objeto insertado por `/api/telemetria`, la tabla, el esquema ni
  las respuestas por almacenamiento. AgroBot no se modificó.

### Dos fuentes posibles, solo una activa

| `ALERT_TRIGGER` | Comportamiento |
| --- | --- |
| `express` o ausente | `/api/telemetria` conserva su INSERT y alerta si supera 30. El webhook autenticado devuelve 409 sin enviar. Útil solo cuando el emisor llama a Express. |
| `webhook` | `/api/telemetria` conserva el mismo INSERT, pero no envía la alerta. El receptor de Supabase es el único que notifica. Es el modo propuesto para el flujo directo indicado por el usuario. |

Nuevo receptor local: `POST /api/webhooks/supabase/telemetria`.

Requiere `Authorization: Bearer <SUPABASE_WEBHOOK_SECRET>`, secreto dedicado de al menos
32 caracteres, comparado sin registrar su valor. No reutilizar `SUPABASE_KEY`,
`RESEND_API_KEY` ni el token de login del frontend para autenticar este webhook.
La ausencia de configuración devuelve 503; un token incorrecto/ausente, 401.
La versión publicada inicial solo procesaba `INSERT`. El cambio local nuevo admite
también `UPDATE` con el contrato descrito en `NOTIFICACIONES.md`. Otros eventos
autenticados se omiten sin enviar. No inserta ni actualiza registros.

Para cada lectura alta, el SDK recibe una `idempotencyKey` estable que incorpora un
hash del proyecto, tabla, ID y tipo/versionado de alerta. El modo exclusivo evita
el doble envío Express + webhook. Las repeticiones de webhook reutilizan esa misma
clave, sin alterar el contenido para un mismo evento.

**Límite explícito:** Resend conserva las claves durante 24 horas. El backend no
incluye una base de datos de notificaciones ni una cola persistente. Repeticiones
fuera de esa ventana pueden volver a enviar; no se promete exactamente una entrega
para siempre ni una recuperación automática de todos los fallos. Una garantía más
amplia requeriría un almacén compartido adicional, separado de telemetría y autorizado.
No se usa un `Set` en memoria como supuesta protección durable entre reinicios.

La respuesta distingue `aceptada` / `entrega: no_confirmada` de `preparada` /
`entrega: no_enviada` en memoria. No se afirma entrega por obtener un ID. Las políticas
de error/timeout y logs seguros del transporte Resend siguen vigentes.

## Pruebas simuladas

Las peticiones a la API de Resend se interceptan antes de salir a red. Supabase es
un doble de prueba; las inserciones de Express son simuladas, nunca registros reales.

| Temperatura | Express activo | Webhook activo |
| --- | --- | --- |
| 29 °C | No prepara alerta | No prepara alerta |
| 30 °C | No prepara alerta | No prepara alerta |
| 35 °C | Una alerta para `ALERT_EMAIL_TO` | Una alerta para `ALERT_EMAIL_TO` |

También se prueba:

- Destinatario de reporte distinto del de alertas, sin direcciones arbitrarias.
- Express en modo webhook: cero envíos antes de la llamada del webhook.
- Evento webhook repetido: dos solicitudes con la misma clave y un único mensaje
  aceptado por el proveedor simulado. Esto verifica el contrato; no es una prueba
  real de idempotencia en la cuenta Resend.
- Rechazo de autenticación, secreto no configurado, ID inválido, otra tabla y DELETE.
- Fallo del proveedor, reentrega con clave estable y logs sin mensajes privados.
- HTML seguro, campos opcionales y conservación del INSERT y su respuesta original.

Comando reproducible: `node --test`. Evidencia local ignorada por Git:
`evidencia/pruebas-alertas-webhook.tap`.
Resultado de la versión INSERT: **36 pruebas aprobadas, 0 fallidas** (29 de regresión
y 7 nuevas). La ampliación UPDATE eleva el resultado a **40 aprobadas, 0 fallidas**.

## Inspección pendiente del mecanismo anterior, solo lectura

Revisar en los paneles, sin cambiar configuración: Database Webhooks y Triggers de
`public.telemetria`, Edge Functions y sus invocaciones, Cron, servicios/schedulers
antiguos y programa emisor. Correlacionar una lectura existente y el correo ya
recibido; no fabricar lecturas de prueba ni ejecutar funciones de envío.
Comparar también el commit realmente desplegado, la ruta y los logs HTTP de Render.
Que una fila exista en historial no permite inferir por sí solo la ruta de ingestión.

Estas consultas de catálogo son opcionales para un administrador. Solo devuelven
metadatos e indicadores, nunca cuerpos de funciones, argumentos, URLs o cabeceras
que podrían contener claves. Los indicadores no sustituyen revisar privadamente
la función implicada y sus llamadas auxiliares.

```sql
SELECT n.nspname AS esquema, c.relname AS tabla, t.tgname AS trigger,
       t.tgenabled AS estado, pn.nspname AS esquema_funcion, p.proname AS funcion,
       (p.prosrc || encode(t.tgargs, 'escape')) ILIKE '%resend%' AS menciona_resend,
       (p.prosrc || encode(t.tgargs, 'escape')) ILIKE '%smtp%' AS menciona_smtp,
       (p.prosrc || encode(t.tgargs, 'escape')) ILIKE '%functions/v1%' AS menciona_edge,
       (p.prosrc || encode(t.tgargs, 'escape')) ILIKE '%http%' AS menciona_http
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
WHERE n.nspname = 'public' AND c.relname = 'telemetria'
  AND NOT t.tgisinternal;

SELECT to_regclass('cron.job') IS NOT NULL AS cron_disponible;
-- Solo si cron_disponible es true:
SELECT jobid, active, schedule,
       command ILIKE '%resend%' AS menciona_resend,
       command ILIKE '%smtp%' AS menciona_smtp,
       command ILIKE '%http%' AS menciona_http
FROM cron.job;
```

No compartir definiciones completas, `tgargs`, comandos de cron ni headers de
solicitudes. Del correo antiguo basta contrastar privadamente dominio remitente,
DKIM y Message-ID con los logs del servicio; no publicar el mensaje ni sus cabeceras
completas con direcciones. La ausencia del correo en Resend es un indicio aportado
por el usuario, no identifica por sí sola el proveedor antiguo.

## Configuración futura propuesta, no aplicada

En Render, mantener las claves existentes e incorporar privadamente:

```dotenv
EMAIL_PROVIDER=resend
EMAIL_FROM=onboarding@resend.dev
REPORT_EMAIL_TO=
ALERT_EMAIL_TO=
ALERT_TRIGGER=webhook
SUPABASE_WEBHOOK_SECRET=
```

Cada destinatario debe ser una única dirección autorizada. Con `onboarding@resend.dev`,
Resend restringe el envío al correo de la cuenta; usarlo también para alertas. Para
reportes a otro correo se necesitaría remitente con dominio verificado y autorización.
No se copian valores desde `.env` ni se introducen esas variables en React/Vercel.

Una vez revisado y autorizado el cambio:

1. Identificar el emisor anterior y acordar su desactivación/reversión por separado.
   Publicar este código no lo desactiva y podría producir dos alertas de sistemas distintos.
2. Desplegar backend con variables y modo `webhook`, sin cambiar almacenamiento.
3. Crear un Database Webhook `INSERT` de `public.telemetria` al receptor HTTPS nuevo,
   `Content-Type: application/json` y el Bearer dedicado. Es configuración futura de
   Supabase y requiere autorización; no se realizó desde esta tarea.
4. Verificar el timeout del webhook frente al de Resend y al arranque de Render Free.
   No asumir que `pg_net` mantiene una cola durable con reintentos garantizados. Revisar
   respuestas y fallos de red; un servicio frío puede impedir completar la llamada.
5. No reenviar eventos históricos ya notificados por Express antes del cambio de modo.
   Coordinar el corte para que no convivan dos fuentes activas y revisar la cola anterior.
6. Solo con autorización, generar o seleccionar la lectura de una prueba controlada,
   verificar un ID en Resend y confirmar recepción. No se ejecutó esa prueba real.

Referencias oficiales: [Database Webhooks](https://supabase.com/docs/guides/database/webhooks),
[pg_net](https://supabase.com/docs/guides/database/extensions/pg_net),
[idempotencia Resend](https://resend.com/docs/dashboard/emails/idempotency-keys).
