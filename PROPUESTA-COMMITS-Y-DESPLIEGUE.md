# AgroValle: commits locales y plan de publicación

## Corrección posterior de alertas, pendiente de revisión

El usuario indica que reportes Resend ya funcionan publicados y que las lecturas
se insertan directamente en Supabase. El emisor del correo antiguo al compañero
sigue sin identificar; el código local anterior solo alertaba al pasar por Express.
Ver `DIAGNOSTICO-ALERTAS.md` antes de cambiar configuración externa.

Los cambios nuevos no se commitearon ni publicaron. Separan `REPORT_EMAIL_TO` y
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

La suite simulada pasó 36 casos sin Supabase real ni envíos. No se creó ningún hook
en Supabase ni se cambió Render/Vercel. El commit de usuario `498498e` eliminó la
plantilla `.env.example`; se respeta esa eliminación y los campos se documentan aquí.

4 de noviembre de 2026. Backend y frontend tienen ramas independientes. No se realizó push, despliegue ni configuración de producción.

El usuario confirmó aceptación del primer envío real de Resend y recepción en Gmail. Esta preparación no repitió el envío. Producción queda preparada para Resend HTTPS y `gemini-3.5-flash-lite`; las variables de los paneles siguen pendientes de configuración manual.

## Ramas y commits para revisar

| Repositorio | Rama local | Commit / contenido |
| --- | --- | --- |
| Backend | `feat/resend-agrobot-release` | `337fb2d` — `feat: integrar Resend HTTPS y estabilizar AgroBot`. Proveedores, parser PDF, errores seguros, plantillas, transporte local en memoria y tests. |
| Backend | `feat/resend-agrobot-release` | Segundo commit documental y de herramientas: contiene este plan, diagnóstico, manual de notificaciones y verificadores. |
| Frontend | `feat/local-api-release` | `a2ef710` — `fix: configurar API y mensajes de integraciones`. API por entorno, mensajes de aceptación/error y bloqueo de solicitudes simultáneas. |

Las ramas `main` conservan sus commits anteriores: backend `bf6ae0f` y frontend `bfa2882`. No se fusionaron ni se publicaron ramas. Se usó la identidad indicada por el usuario solo para los commits, sin configurar Git globalmente.

Revisión local desde cada repositorio:

```powershell
git log --oneline main..HEAD
git diff --stat main...HEAD
git diff main...HEAD
```

Antes de cada commit se revisaron la lista staged, el diff y la búsqueda de credenciales con `node revisar-git.js`. No se detectaron valores secretos en los archivos incluidos. El análisis no constituye una auditoría de todo el historial de commits.

## Archivos excluidos

- `.env`, `.env.local` y demás archivos de entorno reales; `.env.example` sí se versiona, con campos vacíos y valores públicos de configuración.
- `node_modules`, `dist`, perfiles de Chrome, capturas y `.local`.
- `backend/evidencia/`: resultados, auditorías y detalles del equipo se conservan localmente y están ignorados. Se publica el resumen revisado de este documento y del diagnóstico.
- `frontend/package-lock.json`: lockfile vacío, sin seguimiento, fuera de la aplicación `frontend-react`. No se borró ni se incluyó en commits.
- `manual.pdf`: ausente e ignorado; el contexto alternativo continúa activo. No publicar un manual privado sin revisar su contenido.

## Validación repetida para esta publicación

- Backend: `node --test`, 29 aprobadas y 0 fallidas, con Gemini/Resend/SMTP y Supabase simulados según el caso.
- Frontend: `npm run build` y `npm run lint`, correctos.
- Build local adicional con `VITE_API_URL=https://agrovalle-backend-api.onrender.com`: correcto; el bundle no contiene la URL de la API local. No se desplegó ni se versionó `dist`.
- Chrome con backend y Vite recién iniciados en puertos aislados: login, historial y ambas consultas de AgroBot 200; 5 tarjetas; reporte preparado en memoria 200; cero envíos reales y cero escrituras en Supabase.
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
| `EMAIL_USER` | Único destinatario autorizado, coincidente con el correo de la cuenta Resend para usar ese remitente. |
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

## Orden de publicación, todavía no ejecutado

1. Revisar estos commits y confirmar que las ramas de producción/autodeploy de Render y Vercel no cambiarán al publicar ramas de trabajo. Registrar los IDs de despliegues activos y guardar de forma privada la configuración actual.
2. Autorizar después el push de las ramas y crear PR separados. Mantener `main` sin cambios hasta aprobar cada PR. No ejecutar `npm ci` sobre procesos que estén atendiendo producción.
3. Preparar primero el backend candidato. Render: raíz del repositorio backend, build `npm ci`, start `npm start`, variables anteriores. No usar `local-validacion.js`: está pensado para bloquear escrituras y preparar correo sin entregarlo.
4. Comprobar el candidato con login, historial en lectura y AgroBot. No invocar telemetría ni reportes que envíen correo sin autorización específica. No son necesarias migraciones ni nuevas tablas.
5. Publicar backend mediante el flujo de deploy de Render sin detener manualmente el servicio activo. Revisar salud y logs antes de pasar al frontend. No hay ruta `/health` implementada: no configurar una ruta inexistente. La continuidad depende también de arranque, comprobaciones y cierre del servicio; no se garantiza ausencia absoluta de cortes.
6. Preparar y comprobar Vercel Preview con la URL correcta. Crear la versión con variables de producción y verificar el build resultante; promover un Preview puede reconstruir con esas variables. Mantener el frontend publicado hasta aprobar la versión nueva.
7. Publicar el frontend solo cuando el backend esté estable. Repetir login, historial, CORS y AgroBot desde Vercel; comprobar que no se usa localhost. Coordinar por separado cualquier envío real o prueba con telemetría.

La confirmación del envío real de Resend elimina el pendiente de validación local del proveedor; aún no acredita un envío desde el entorno Render actualizado. Ese control queda para el despliegue autorizado.

## Reversión

- Antes de publicar, registrar IDs del backend y frontend activos. Las referencias Git base anteriores ayudan a revisar diferencias, pero no sustituyen los IDs reales del proveedor.
- Si falla React, usar Instant Rollback al último despliegue estable de Vercel y repetir login/historial. El backend nuevo conserva las rutas del cliente anterior.
- Si falla el backend, volver al último despliegue estable de Render sin tocar Supabase. Revisar las variables por separado: un rollback de código no implica restaurar toda configuración.
- Mantener `JWT_SECRET` y credenciales del proyecto. No hacer migraciones inversas ni restaurar datos: esta publicación no cambia el esquema ni los registros.
- Coordinar `EMAIL_PROVIDER` y `GEMINI_MODEL` con el código al que se vuelve. El backend base anterior no incorpora Resend y su modelo anterior presentó fallos: volver a él preserva principalmente login/historial, no garantiza correo ni AgroBot. SMTP continúa bloqueado en Render Free; no presentarlo como respaldo funcional.
- No revertir con `git reset --hard` ni hacer force-push. Si se requiere revertir cambios en Git más adelante, preparar commits de revert tras la revisión correspondiente.

Fuentes oficiales: [Render deploys](https://render.com/docs/deploys), [health checks](https://render.com/docs/health-checks), [rollback](https://render.com/docs/rollbacks), [Node en Render](https://render.com/docs/node-version), [promoción Vercel](https://vercel.com/docs/deployments/promote-preview-to-production), [Instant Rollback](https://vercel.com/docs/instant-rollback), [Node en Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
