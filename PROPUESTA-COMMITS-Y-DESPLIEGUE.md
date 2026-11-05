# AgroValle: estado de GitHub y plan de publicación de alertas

## Estado comprobado el 4 de noviembre de 2026

**Cambio posterior pendiente:** tras confirmar el usuario que la alerta INSERT
funcionó y que habilitó UPDATE en Supabase, se preparó localmente el cruce <=30→>30
para actualizaciones. Requiere estado anterior y versión temporal nueva, sin cambios
de tabla ni credenciales. Afecta `alertas.js`, `index.js`, la lista segura de códigos
de log en `integraciones.js`, tests de webhook y documentación. No se hizo commit,
push ni deploy de esta ampliación. Antes de probar UPDATE real, revisar y publicar
este cambio con autorización; el webhook ya marcado no incorpora código en Render.
Validación final del soporte UPDATE: **40/40 pruebas aprobadas**, sin red externa
ni almacenamiento real, y auditoría de archivos versionables sin coincidencias
sensibles detectadas. Propuesta para revisión, sin crear el commit:
`feat: alertar al cruzar el umbral en actualizaciones de telemetria`.

El usuario indica que reportes Resend ya funcionan publicados y que las lecturas
se insertan directamente en Supabase. El emisor del correo antiguo al compañero
sigue sin identificar; el código local anterior solo alertaba al pasar por Express.
Ver `DIAGNOSTICO-ALERTAS.md` antes de cambiar configuración externa.

Los cambios están en el commit `9265dce`, publicado en la rama de trabajo del
backend, todavía fuera de `main`. Separan `REPORT_EMAIL_TO` y
`ALERT_EMAIL_TO`, fuerzan Resend para alertas y añaden el receptor autenticado
`POST /api/webhooks/supabase/telemetria`, sin cambiar el INSERT ni AgroBot.
Para el flujo confirmado, proponer `ALERT_TRIGGER=webhook` y un secreto dedicado
`SUPABASE_WEBHOOK_SECRET` de al menos 32 caracteres. Ambos destinos se configuran
privadamente, una dirección por variable; no se permiten destinatarios desde React.

Antes de activar un Database Webhook: identificar y desactivar con autorización
el proceso antiguo, desplegar el receptor y sus variables, coordinar el corte de
fuente y revisar timeouts. Express no notifica cuando está seleccionado el webhook;
los eventos repetidos usan idempotencia Resend de 24 horas. No hay protección durable
fuera de esa ventana ni cola persistente de recuperación en este cambio.

La suite simulada volvió a aprobar 36 casos sin Supabase real ni envíos. El build y
lint del frontend también aprobaron. No se creó ningún hook
en Supabase ni se cambió Render/Vercel. El commit de usuario `498498e` eliminó la
plantilla `.env.example`; se respeta esa eliminación y los campos se documentan aquí.

En esta revisión no se realizó commit, push, despliegue ni configuración de producción.
Se consultaron ramas vivas con `git ls-remote` y se descargaron referencias con
`git fetch origin`. Backend: `origin/main=9a8f938`,
`origin/feat/resend-agrobot-release=9265dce`. Frontend: `origin/main=0941c9d`,
`origin/feat/local-api-release=a2ef710`. Las ramas locales `main` conservan las bases
antiguas; no representan el estado actual de GitHub.

La petición vacía y sin autenticación al nuevo receptor de Render devolvió
404 `Cannot POST`. La ruta no estaba disponible en la URL pública comprobada. El
usuario indicó que Render utiliza `feat/resend-agrobot-release` y después informó
el SHA del deploy: **`9a8f938`**. Ese commit es el merge anterior de `main` y no
contiene el receptor de alertas. Explica el 404; no incluye la corrección `9265dce`.
La información del deploy proviene del usuario, sin acceso directo al panel. Antes
de publicar, contrastar la rama configurada y el commit elegido en Render: el SHA
por sí solo no acredita que se haya desplegado la punta actual de esa rama.

El usuario confirmó que el reporte publicado funciona con Resend y llega a Gmail.
Esta revisión no repitió el envío. Conservar esa integración y el modelo validado
`gemini-3.5-flash-lite`; no se verificaron los valores privados de los paneles.

## Ramas y commits para revisar

| Repositorio | Rama local | Commit / contenido |
| --- | --- | --- |
| Backend | `feat/resend-agrobot-release` | `337fb2d` — `feat: integrar Resend HTTPS y estabilizar AgroBot`. Proveedores, parser PDF, errores seguros, plantillas, transporte local en memoria y tests. |
| Backend | `feat/resend-agrobot-release` | `d08da46` — documentación y herramientas; ya incluido en `main` mediante `9a8f938`. |
| Backend | `feat/resend-agrobot-release` | `498498e` — elimina `.env.example`; pendiente de incluir en `main`. |
| Backend | `feat/resend-agrobot-release` | `9265dce` — destinatarios separados, alertas Resend, webhook autenticado y tests; pendiente de incluir en `main`. |
| Frontend | `feat/local-api-release` | `a2ef710` — `fix: configurar API y mensajes de integraciones`. API por entorno, mensajes de aceptación/error y bloqueo de solicitudes simultáneas. |

GitHub `main` ya incluye los primeros commits de integración: backend `9a8f938`
y frontend `0941c9d` son merges. Esta corrección no requiere otro cambio de React.
El backend estaba limpio al empezar la revisión; ahora solo se actualizaron tres
documentos: este plan, `DIAGNOSTICO-ALERTAS.md` y `DIAGNOSTICO-INTEGRACIONES.md`.
No se añadieron al índice ni se crearon commits nuevos.

El commit `9265dce` modifica 13 archivos: `alertas.js`, `index.js`,
`integraciones.js`, `diagnostico.js`, `local-validacion.js`, `revisar-git.js`,
`test/alertas-webhook.test.js`, `test/correo-resend.test.js`,
`test/integraciones.test.js` y los cuatro documentos de diagnóstico/notificaciones/
publicación. La eliminación de `.env.example` pertenece a `498498e`.

Revisión local desde cada repositorio:

```powershell
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git diff origin/main...HEAD
```

Antes de cada commit se revisaron la lista staged, el diff y la búsqueda de credenciales con `node revisar-git.js`. No se detectaron valores secretos en los archivos incluidos. El análisis no constituye una auditoría de todo el historial de commits.

## Archivos excluidos

- `.env`, `.env.local` y demás archivos de entorno reales están ignorados. La rama
  de trabajo ya eliminó `.env.example` por decisión del usuario; no se restauró.
- `node_modules`, `dist`, perfiles de Chrome, capturas y `.local`.
- `backend/evidencia/`: resultados, auditorías y detalles del equipo se conservan localmente y están ignorados. Se publica el resumen revisado de este documento y del diagnóstico.
- `frontend/package-lock.json`: lockfile vacío, sin seguimiento, fuera de la aplicación `frontend-react`. No se borró ni se incluyó en commits.
- `manual.pdf`: ausente e ignorado; el contexto alternativo continúa activo. No publicar un manual privado sin revisar su contenido.

## Validación repetida para esta publicación

- Backend: `node --test`, **36 aprobadas y 0 fallidas**, con Gemini/Resend/SMTP y
  Supabase simulados según el caso. Incluye autenticación, 29/30/35 °C, reporte
  independiente y evento repetido con la misma clave. Evidencia actual:
  `evidencia/pruebas-alertas-webhook.tap`.
- Frontend: `npm run build` y `npm run lint`, correctos.
- En la preparación anterior se validó además un build con URL pública y navegación
  Chrome local: login, historial, AgroBot y reporte preparado en memoria. No se
  repitió navegación ni prueba real de correo en esta revisión; no se versiona `dist`.
- El arranque de prueba fuerza el modelo validado y bloquea telemetría. El arranque normal usa ahora también `gemini-3.5-flash-lite` si no se define modelo; configurar el mismo valor explícitamente en Render.
- La API conserva rutas y contratos principales; el frontend anterior puede recibir `ok`, `respuesta` y `mensaje` del backend nuevo. El frontend nuevo entiende aceptación de Resend y errores públicos sin asumir entrega.

Evidencia local: `evidencia/pruebas-publicacion.tap`, `evidencia/build-publicacion.json`, `evidencia/validacion-windows.json` y `evidencia/revision-git.json`. Estos archivos no se incluyen en Git.

## Variables manuales de Render

Configurar cuando se autorice producción, conservando los valores privados existentes donde corresponda. No copiar el `.env` completo al repositorio.

| Variable | Valor / acción |
| --- | --- |
| `EMAIL_PROVIDER` | `resend` |
| `RESEND_API_KEY` | Clave privada de la cuenta probada, con permiso de envío. |
| `EMAIL_FROM` | `onboarding@resend.dev` durante esta fase de prueba. |
| `REPORT_EMAIL_TO` | Correo autorizado de reportes, asociado a la cuenta Resend mientras se use el dominio de prueba. Si falta, se conserva `EMAIL_USER` por compatibilidad. No dejar explícitamente vacío. |
| `ALERT_EMAIL_TO` | Correo autorizado de alertas, asociado a la cuenta Resend. Obligatorio; no toma el destinatario antiguo como alternativa. |
| `ALERT_TRIGGER` | `webhook`, porque las lecturas llegan directamente a Supabase. |
| `SUPABASE_WEBHOOK_SECRET` | Secreto dedicado de al menos 32 caracteres, compartido solo con la cabecera Bearer del Database Webhook. |
| `EMAIL_USER` | Conservar para compatibilidad del reporte antiguo o autenticación SMTP local; no controla el destino de las alertas nuevas. |
| `RESEND_TIMEOUT_MS` | `15000` |
| `GEMINI_API_KEY` | Clave privada probada. |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` |
| `SUPABASE_URL` | URL del proyecto actual, sin cambiar de proyecto. |
| `SUPABASE_KEY` | Clave privada actual con acceso a las operaciones existentes. |
| `ADMIN_USER`, `ADMIN_PASS` | Credenciales administrativas existentes. |
| `JWT_SECRET` | Mantener el secreto existente para no invalidar tokens por un cambio innecesario. |
| `NODE_VERSION` | Referencia validada: `24.21.0`; verificar la versión del build. |
| `PORT` | Usar el puerto proporcionado por Render; el servidor escucha en `0.0.0.0`. |

`EMAIL_PASS`, `SMTP_HOST` y `SMTP_PORT` no se necesitan con Resend. SMTP se conserva para compatibilidad local; no activarlo como fallback en Render Free. No activar `RESEND_DEBUG=true`. No hace falta añadir proxy, certificados especiales ni desactivar SSL.

Resend aceptado no equivale a entregado: el reporte devuelve estado `aceptado`, entrega `no_confirmada` y el ID del proveedor. La recepción de la prueba fue confirmada por el usuario; no se añade un webhook de entrega en este alcance.

## Variables y build de Vercel

Repositorio frontend, Root Directory `frontend-react`, instalación `npm ci`, build `npm run build`, salida `dist`, Node `24.x` en el panel.

| Variable | Valor |
| --- | --- |
| `VITE_API_URL` | `https://agrovalle-backend-api.onrender.com` |

Aplicar la URL al entorno de producción y al Preview que vaya a probarse. Las variables `VITE_` son públicas: no colocar claves de Resend, Supabase, Gemini, JWT o SMTP en Vercel ni en el bundle. Cambiar esta URL requiere recompilar. La selección de proveedor y modelo ocurre en el backend, no en React.

## Orden propuesto para la corrección, todavía no ejecutado

1. Revisar estos commits y confirmar que las ramas de producción/autodeploy de Render y Vercel no cambiarán al publicar ramas de trabajo. Registrar los IDs de despliegues activos y guardar de forma privada la configuración actual.
2. Las ramas ya existen en GitHub. Preparar para revisión el PR del backend que
   incluya `498498e` y `9265dce`; comprobar si un merge activa autodeploy antes de
   autorizarlo. Si se desea publicar la documentación actual, revisarla, auditarla
   y autorizar por separado su commit/push. No requiere PR funcional de frontend.
3. Preparar primero el backend candidato. Render: raíz del repositorio backend, build `npm ci`, start `npm start`, variables anteriores. No usar `local-validacion.js`: está pensado para bloquear escrituras y preparar correo sin entregarlo.
4. Comprobar el candidato con login, historial en lectura y AgroBot. No invocar telemetría ni reportes que envíen correo sin autorización específica. No son necesarias migraciones ni nuevas tablas.
5. Publicar backend mediante el flujo de deploy de Render sin detener manualmente el servicio activo. Revisar salud y logs antes de pasar al frontend. No hay ruta `/health` implementada: no configurar una ruta inexistente. La continuidad depende también de arranque, comprobaciones y cierre del servicio; no se garantiza ausencia absoluta de cortes.
6. Antes de activar el webhook, identificar el emisor antiguo y autorizar su
   desactivación por separado. Registrar cómo revertirlo. La corrección no lo
   detiene y no comparte con él la idempotencia. Sin identificarlo, quedan posibles
   alertas de dos sistemas distintos.
7. Con autorización para configurar Supabase, crear un Database Webhook solo para
   INSERT de `public.telemetria`, URL
   `https://agrovalle-backend-api.onrender.com/api/webhooks/supabase/telemetria`,
   `Content-Type: application/json` y `Authorization: Bearer <secreto dedicado>`.
   No publicar el secreto. Coordinar el cambio a `ALERT_TRIGGER=webhook` y la
   activación: entre ambos pasos puede existir una ventana sin alertas. Revisar
   timeouts y arranque en frío; no se incorpora cola durable ni se presume reintento.
8. Comprobar login, historial y AgroBot desde el Vercel actual. No hace falta
   redesplegar React para esta corrección. Una prueba real de alerta y/o reporte
   requiere autorización específica para la lectura y el envío. Comprobar aceptación
   en Resend y recepción por separado. No reenviar el historial como prueba.

El reporte desde Render ya fue confirmado por el usuario. Queda pendiente la
alerta mediante el nuevo webhook en producción. La idempotencia del proveedor
dura 24 horas y requiere el mismo evento y contenido; no evita correos de un emisor
externo ni garantiza deduplicación permanente. Ver
[Resend](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Reversión

- Antes de publicar, registrar IDs del backend y frontend activos. Las referencias Git base anteriores ayudan a revisar diferencias, pero no sustituyen los IDs reales del proveedor.
- Si el nuevo webhook falla, desactivarlo con autorización antes de volver a una
  versión que no tenga el receptor. No cambiar a modo `express` como solución para
  lecturas directas: esas lecturas no pasan por Express. No reactivar el emisor
  anterior sin acordar destinatario y riesgos. Coordinar la reversión de variables
  y webhook además del código; podría haber una pausa en alertas.
- Si falla React, usar Instant Rollback al último despliegue estable de Vercel y repetir login/historial. El backend nuevo conserva las rutas del cliente anterior.
- Si falla el backend, volver al último despliegue estable de Render sin tocar Supabase. Revisar las variables por separado: un rollback de código no implica restaurar toda configuración.
- Mantener `JWT_SECRET` y credenciales del proyecto. No hacer migraciones inversas ni restaurar datos: esta publicación no cambia el esquema ni los registros.
- Coordinar `EMAIL_PROVIDER` y `GEMINI_MODEL` con el código al que se vuelve. Preferir
  el último despliegue estable con Resend ya confirmado para reportes; registrar su
  SHA desde Render. Las bases antiguas `bf6ae0f`/`a39c21a` no son alternativas
  equivalentes: no incluyen esa integración. SMTP no es el respaldo propuesto en
  Render Free.
- No revertir con `git reset --hard` ni hacer force-push. Si se requiere revertir cambios en Git más adelante, preparar commits de revert tras la revisión correspondiente.

Fuentes oficiales: [Render deploys](https://render.com/docs/deploys), [health checks](https://render.com/docs/health-checks), [rollback](https://render.com/docs/rollbacks), [Node en Render](https://render.com/docs/node-version), [promoción Vercel](https://vercel.com/docs/deployments/promote-preview-to-production), [Instant Rollback](https://vercel.com/docs/instant-rollback), [Node en Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
