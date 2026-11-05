# Notificaciones de AgroValle: Resend, SMTP y preparación local

Actualización del 4 de noviembre de 2026: el usuario confirmó que una alerta por
INSERT directo de una lectura alta ya funcionó. Después habilitó UPDATE en su
webhook. El soporte de UPDATE descrito aquí es un cambio local nuevo, sin desplegar.
Ver `DIAGNOSTICO-ALERTAS.md` para los antecedentes.
El usuario confirmó aceptación por Resend y recepción en Gmail de la primera prueba
real. Esa confirmación no se presenta como una nueva prueba ejecutada por el agente.
SDK oficial `resend` 6.37.0 fijado en `package.json` y `package-lock.json`.

## Actualizaciones de filas existentes (cambio local pendiente)

El receptor admite INSERT y UPDATE autenticados de `public.telemetria`. INSERT
conserva su comportamiento y su clave publicada. UPDATE envía solo al cruzar de
temperatura anterior <=30 a nueva >30; 35→36, 35→29 y 29→30 no envían. Requiere
`old_record` con ID de la misma fila y temperatura anterior válida. No consulta
Supabase ni modifica registros para reconstruir ese estado.

Para distinguir un nuevo cruce del reintento de uno anterior, UPDATE requiere
`updated_at`, si existe, o `fecha_hora`, con valores válidos en ambos estados y
valor nuevo posterior al anterior. Cada actualización notificable debe tener una
versión única. No se crean columnas ni triggers automáticamente. Si se usa Table
Editor y no hay `updated_at` mantenido por el proyecto, actualizar `fecha_hora`
junto con la temperatura al registrar una medición nueva en esa fila. Si esa fecha
debe preservar la medición original, no cambiarla arbitrariamente: se necesitará
acordar una columna de versión/fecha de actualización por separado.

La clave incorpora el ID, tipo UPDATE y hash de esa versión; un reintento del mismo
evento conserva la clave y un nuevo cruce con versión distinta usa otra. La ventana
de deduplicación sigue siendo de 24 horas, no una garantía permanente. No se usa
la hora de recepción como identidad del evento. Configurar UPDATE en Supabase no
actualiza automáticamente el código desplegado en Render.

Errores sin envío: 400 `WEBHOOK_ANTERIOR_INVALIDO` si falta el estado anterior de
una actualización alta, o 400 `WEBHOOK_VERSION_REQUERIDA` si hay cruce pero no nueva
versión válida. Los estados no altos o que ya estaban altos se omiten sin enviar.
No repetir una edición real solo para investigar un error: revisar primero el evento.

Contrato del payload: [Supabase Database Webhooks](https://supabase.com/docs/guides/database/webhooks).
Límite de idempotencia: [Resend](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Selección del transporte

`crearCorreo(env)` (reportes) en `integraciones.js` selecciona `EMAIL_PROVIDER`:

| Valor | Comportamiento |
| --- | --- |
| ausente o `smtp` | Nodemailer: autenticación/remitente `EMAIL_USER`, destinatario `REPORT_EMAIL_TO` con fallback a `EMAIL_USER`. |
| `resend` | SDK oficial de Resend, `POST https://api.resend.com/emails` por HTTPS. |
| otro | Error de configuración al intentar enviar; no se cambia a otro proveedor. |

`crearCorreo(env, 'alerta')` usa siempre Resend y requiere `ALERT_EMAIL_TO`.
No cae al destinatario ni al proveedor SMTP antiguos. Los propósitos son seleccionados
por el backend y no por parámetros del frontend.

`local-validacion.js` inyecta su propio transporte en memoria y no utiliza ninguno
de los proveedores de envío, incluso si `.env` selecciona Resend. Conserva el bloqueo
de escrituras de telemetría y prepara reportes sin conectarse a SMTP o a Resend.
Se puede ejecutar para revisar la aplicación mientras el envío real no esté autorizado.

## Variables para Render Free

Configurar privadamente en Render cuando se autorice el despliegue:

```dotenv
EMAIL_PROVIDER=resend
RESEND_API_KEY=
EMAIL_FROM=onboarding@resend.dev
EMAIL_USER=
REPORT_EMAIL_TO=
ALERT_EMAIL_TO=
ALERT_TRIGGER=webhook
SUPABASE_WEBHOOK_SECRET=
RESEND_TIMEOUT_MS=15000
```

- `RESEND_API_KEY`: clave con permiso de envío, nunca en Git ni en variables `VITE_`.
- `REPORT_EMAIL_TO` y `ALERT_EMAIL_TO`: destinatarios independientes, cada uno una sola
  dirección sin nombre de presentación, comas ni listas. Con el remitente de prueba deben coincidir con el
  correo de la cuenta Resend. La aplicación no puede comprobar esa asociación antes
  de un envío real: Resend aplica la restricción y puede responder 403.
- `EMAIL_USER`: autenticación SMTP y fallback de reportes si `REPORT_EMAIL_TO` no existe.
  Nunca es fallback de alertas. Un `REPORT_EMAIL_TO` explícitamente vacío se rechaza.
- `ALERT_TRIGGER=webhook`: para lecturas directas de Supabase. `express` es el modo de
  compatibilidad para lecturas que llegan por POST al backend; no están activos ambos.
- `SUPABASE_WEBHOOK_SECRET`: secreto independiente, al menos 32 caracteres, solo para
  el Bearer del webhook Supabase/backend; no se entrega al navegador.
- `EMAIL_FROM`: remitente del servidor. Para esta fase, `onboarding@resend.dev`.
  Un dominio propio requiere verificación antes de seleccionarlo.
- `RESEND_TIMEOUT_MS`: entero de 1 a 60000, predeterminado 15000 ms.
- `EMAIL_PASS`, `SMTP_HOST` y `SMTP_PORT` solo se necesitan al seleccionar SMTP.
  No se eliminaron ni cambiaron credenciales existentes.
- Supabase, Gemini, JWT, administrador y `PORT` mantienen sus variables actuales.

El usuario eliminó `.env.example` en `498498e`; no se restauró. Usar los nombres
documentados arriba para configurar privadamente el entorno. El código conserva SMTP
para reportes si falta la variable, por compatibilidad. No se cambió `.env`.
El diagnóstico local sin flags informa presencia de claves y proveedor, sin enviar ni
autenticar contra servicios. En la revisión actual informa Resend seleccionado y campos
de clave/remitente presentes; **esto no acredita autenticación ni entrega real con Resend**.

## Destinatario y contenido

Los endpoints siguen siendo `POST /api/reporte` y `POST /api/telemetria`.
El reporte mantiene la consulta de las diez últimas lecturas y su tabla HTML original.
La alerta conserva el HTML y el umbral `temperatura > 30`.

El transporte construye el destinatario únicamente desde el campo de entorno de su
propósito: `REPORT_EMAIL_TO` (o fallback de compatibilidad) / `ALERT_EMAIL_TO`.
Solo se propagan `subject`, `html` y `text` del mensaje: se descartan `to`, `from`,
`cc`, `bcc`, `envelope`, cabeceras y otras opciones recibidas del llamador.
El cuerpo HTTP no puede seleccionar remitentes ni destinatarios alternativos.
El remitente Resend viene exclusivamente de `EMAIL_FROM`.

## Aceptación y entrega

Resend debe devolver un `data.id` no vacío y ningún error para considerar la solicitud
aceptada. El reporte conserva HTTP 200 y `ok: true`; añade:

```json
{
  "correo": {
    "proveedor": "resend",
    "estado": "aceptado",
    "entrega": "no_confirmada",
    "messageId": "identificador-del-proveedor"
  },
  "mensaje": "Reporte aceptado por Resend; entrega aún no confirmada"
}
```

La respuesta real también conserva `ok: true`. La alerta registra aceptación y entrega
no confirmada, mientras `/api/telemetria` mantiene su respuesta por el guardado de datos.
El fallo de notificación no convierte un guardado ya exitoso en un error HTTP.
El transporte en memoria continúa respondiendo `preparado: true` y no anuncia envío.

La aceptación no acredita entrega al servidor de correo ni llegada a bandeja principal.
La confirmación posterior puede revisarse en Resend; un futuro webhook `email.delivered`
requeriría un alcance adicional y validación de firma. No se añadió un webhook ni una
tabla de seguimiento en esta migración.

## Errores, timeout y logs

| Situación | HTTP del reporte / código |
| --- | --- |
| Configuración o destinatario inválidos | 503, `RESEND_NO_CONFIGURADO`, `EMAIL_PROVIDER_INVALIDO` o `EMAIL_DESTINATARIO_INVALIDO` |
| API rechaza clave, permisos, remitente o destinatario | 502, `RESEND_RECHAZADO` |
| Límite de solicitudes/cuota, 429 | 503, `RESEND_CUOTA` |
| Proveedor responde 5xx | 503, `RESEND_NO_DISPONIBLE` |
| Se agota el timeout | 504, `RESEND_TIMEOUT` |
| Fallo de red / respuesta sin confirmación válida | 502, `RESEND_ERROR` / `RESEND_RESPUESTA_INVALIDA` |

Se pasa `AbortSignal` al SDK y se limpia el temporizador al terminar. No hay reintentos
automáticos ni fallback SMTP: un timeout puede dejar incierto si el proveedor llegó a
aceptar la solicitud. Revisar el estado antes de decidir un nuevo envío autorizado.
El SDK usa el origen HTTPS oficial fijado por el transporte; no se desactiva SSL.

Los logs contienen códigos permitidos y estados numéricos. No incluyen errores crudos
del proveedor, direcciones, cuerpos, claves, cabeceras o stacks. No activar
`RESEND_DEBUG=true`: el transporte lo rechaza para impedir logs crudos del SDK.
El verificador de Git ahora también comprueba el valor local de `RESEND_API_KEY`.

## Pruebas ejecutadas y pendientes

```powershell
node --test
node diagnostico.js
```

Las pruebas usan el SDK instalado con `fetch` simulado y servidores HTTP locales.
Última ejecución: **40 pruebas aprobadas, 0 fallidas**, incluidos 29 casos anteriores
y 11 de alertas/webhook. Reporte conservado en `evidencia/pruebas-alertas-update.tap`.
Supabase es un doble de prueba; ningún registro real se inserta o modifica.
Se comprueban HTML, destinatario fijo, ausencia de CC/BCC, aceptación sin entrega,
errores 401/403/422/429/500, timeout, red, respuesta sin ID, selección de proveedor,
reportes, alertas 30/31, compatibilidad SMTP y preparación MIME en memoria.

`node diagnostico.js --smtp` verifica siempre SMTP, aunque `EMAIL_PROVIDER=resend`.
No valida Resend. No existe una verificación SMTP equivalente para la API de Resend
en esta implementación. `--send-test` utiliza el proveedor seleccionado, constituye
un envío real y **no se ejecutó** en esta sesión. Requiere autorización expresa nueva.

El usuario ya confirmó el reporte y la alerta INSERT publicados. Pendiente: revisar
y autorizar la publicación de este soporte nuevo de UPDATE y, por separado, su
prueba real. No se repitieron envíos ni se modificó producción durante esta ampliación.
La migración no publica cambios ni habilita transportes en producción por sí misma.

Fuentes oficiales: [SDK Node](https://github.com/resend/resend-node),
[enviar email](https://resend.com/docs/api-reference/emails/send-email),
[restricción de resend.dev](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain),
[errores](https://resend.com/docs/api-reference/errors) y
[eventos de entrega](https://resend.com/docs/webhooks/event-types).
