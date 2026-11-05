# Alertas de temperatura: origen y corrección local propuesta

4 de noviembre de 2026. Cambios locales sin commit, push ni despliegue. No se enviaron
correos reales, no se consultó ni modificó Supabase en esta fase. Las consultas SQL
incluidas más abajo son una propuesta de inspección, no fueron ejecutadas.

## Diagnóstico primero: qué está confirmado

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
Solo procesa `INSERT` de `public.telemetria` con ID de lectura válido. Otros eventos
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
- Rechazo de autenticación, secreto no configurado, ID inválido, otra tabla y UPDATE.
- Fallo del proveedor, reentrega con clave estable y logs sin mensajes privados.
- HTML seguro, campos opcionales y conservación del INSERT y su respuesta original.

Comando reproducible: `node --test`. Evidencia local ignorada por Git:
`evidencia/pruebas-alertas-webhook.tap`.
Resultado final: **36 pruebas aprobadas, 0 fallidas** (29 de regresión y 7 nuevas).

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
