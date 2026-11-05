# Pruebas de AgroBot y notificaciones

Fecha de inicio: 4 de noviembre de 2026. Entorno: Windows, PowerShell, Node 24.21.0.

## Orden reproducible

1. Inventariar dependencias, variables (solo presencia), PDF y llamadas del frontend.
2. Antes de corregir, iniciar el backend local en un puerto de prueba y enviar por HTTP:
   - `POST /api/chatbot` con `{"pregunta":"Hola, responde brevemente."}`.
   - `POST /api/chatbot` con `{"pregunta":"¿Cuál es el rango óptimo de humedad según el manual?"}`.
   - Preflight `OPTIONS /api/chatbot` con un origen de navegador y Content-Type JSON.
3. Consultar esas mismas preguntas en la URL pública de Render, sin modificar datos.
   Registrar estado HTTP, respuesta pública y duración; no volcar errores completos del SDK.
4. Reproducir la incompatibilidad PDF con un documento sintético, sin reemplazar el manual real.
5. Probar reportes y umbral de alerta en HTTP con Supabase simulado y transporte de correo
   local: 30 °C no envía; >30 °C genera una alerta; fallos SMTP no deben anunciar éxito.
   No invocar `/api/telemetria` ni `/api/reporte` en producción durante esta fase.
6. Aplicar correcciones mínimas y repetir los casos locales, errores y configuración ausente.
7. Con credenciales disponibles: listar modelos Gemini y ejecutar las dos preguntas reales;
   verificar SMTP con `verify()` (sin enviar mensajes). Enviar un único correo de prueba
   solo mediante una opción explícita, al mismo EMAIL_USER configurado. La aceptación SMTP
   no demuestra recepción: comprobar también la bandeja del destinatario.
8. Validar compilación del frontend y documentar pasos de Render/Vercel pendientes.

## Límites

- `.env` no se imprime, publica ni añade a Git.
- No se cambian credenciales, planes ni variables de producción.
- No se insertan registros en Supabase para probar alertas.
- Una prueba simulada no se presenta como envío real o respuesta real de Gemini.
- Sin acceso al panel de Render no se puede confirmar su plan, variables, versión de Node
  ni logs internos. La URL de Vercel debe verificarse cuando esté disponible.
