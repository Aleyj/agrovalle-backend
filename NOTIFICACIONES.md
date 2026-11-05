# Notificaciones de AgroValle: Resend, SMTP y preparación local

Implementación preparada para revisión el 4 de noviembre de 2026. No desplegada.
El usuario confirmó aceptación por Resend y recepción en Gmail de la primera prueba
real. Esa confirmación no se presenta como una nueva prueba ejecutada por el agente.
SDK oficial `resend` 6.37.0 fijado en `package.json` y `package-lock.json`.

## Selección del transporte

`crearCorreo(env)` en `integraciones.js` selecciona `EMAIL_PROVIDER`:

| Valor | Comportamiento |
| --- | --- |
| ausente o `smtp` | Nodemailer, configuración SMTP anterior, remitente y destinatario `EMAIL_USER`. |
| `resend` | SDK oficial de Resend, `POST https://api.resend.com/emails` por HTTPS. |
| otro | Error de configuración al intentar enviar; no se cambia a otro proveedor. |

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
RESEND_TIMEOUT_MS=15000
```

- `RESEND_API_KEY`: clave con permiso de envío, nunca en Git ni en variables `VITE_`.
- `EMAIL_USER`: **el mismo destinatario autorizado**, como una sola dirección sin nombre
  de presentación, comas ni listas. Con el remitente de prueba debe coincidir con el
  correo de la cuenta Resend. La aplicación no puede comprobar esa asociación antes
  de un envío real: Resend aplica la restricción y puede responder 403.
- `EMAIL_FROM`: remitente del servidor. Para esta fase, `onboarding@resend.dev`.
  Un dominio propio requiere verificación antes de seleccionarlo.
- `RESEND_TIMEOUT_MS`: entero de 1 a 60000, predeterminado 15000 ms.
- `EMAIL_PASS`, `SMTP_HOST` y `SMTP_PORT` solo se necesitan al seleccionar SMTP.
  No se eliminaron ni cambiaron credenciales existentes.
- Supabase, Gemini, JWT, administrador y `PORT` mantienen sus variables actuales.

La plantilla `.env.example` prepara `EMAIL_PROVIDER=resend` para Render Free;
para pruebas SMTP seleccionar `smtp`. El código conserva SMTP si falta la variable
para compatibilidad con instalaciones existentes. No se cambió `.env` durante la migración.
El diagnóstico local sin flags informa presencia de claves y proveedor, sin enviar ni
autenticar contra servicios. En la revisión actual informa Resend seleccionado y campos
de clave/remitente presentes; **esto no acredita autenticación ni entrega real con Resend**.

## Destinatario y contenido

Los endpoints siguen siendo `POST /api/reporte` y `POST /api/telemetria`.
El reporte mantiene la consulta de las diez últimas lecturas y su tabla HTML original.
La alerta conserva el HTML y el umbral `temperatura > 30`.

Ambos transportes de envío construyen el destinatario únicamente desde `EMAIL_USER`.
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
Última ejecución: **29 pruebas aprobadas, 0 fallidas**. Reporte conservado en
`evidencia/pruebas-resend.tap`.
Supabase es un doble de prueba; ningún registro real se inserta o modifica.
Se comprueban HTML, destinatario fijo, ausencia de CC/BCC, aceptación sin entrega,
errores 401/403/422/429/500, timeout, red, respuesta sin ID, selección de proveedor,
reportes, alertas 30/31, compatibilidad SMTP y preparación MIME en memoria.

`node diagnostico.js --smtp` verifica siempre SMTP, aunque `EMAIL_PROVIDER=resend`.
No valida Resend. No existe una verificación SMTP equivalente para la API de Resend
en esta implementación. `--send-test` utiliza el proveedor seleccionado, constituye
un envío real y **no se ejecutó** en esta sesión. Requiere autorización expresa nueva.

Pendiente: autorizar publicación y configurar el entorno de Render. El primer envío
real y su recepción ya fueron confirmados por el usuario; no se repitieron durante
la preparación de commits. Una comprobación real desde Render necesitará autorización.
La migración no publica cambios ni habilita transportes en producción por sí misma.

Fuentes oficiales: [SDK Node](https://github.com/resend/resend-node),
[enviar email](https://resend.com/docs/api-reference/emails/send-email),
[restricción de resend.dev](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain),
[errores](https://resend.com/docs/api-reference/errors) y
[eventos de entrega](https://resend.com/docs/webhooks/event-types).
