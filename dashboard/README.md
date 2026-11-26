# Análisis de AgroValle dentro de React

Correccion del lector de fechas: se usa format="ISO8601" para admitir timestamps
de Supabase con/sin microsegundos, Z y offsets horarios en el mismo lote. La
inferencia anterior podia omitir fechas validas. Las fechas realmente vacias o
invalidas siguen omitiendose con aviso; no se modifican datos en Supabase.

Actualizacion visual del 24 de noviembre: Manrope se sirve desde static/Manrope.ttf,
con licencia en static/OFL-Manrope.txt; no se consulta Google Fonts al mostrar la app.
Paleta verde/dorada y temas claro/oscuro, graficas con la misma fuente y explicaciones
en «Como interpretar estos datos». Los avisos de registros omitidos y resultados
parciales siguen visibles. Reiniciar Streamlit tras cambiar config.toml para activar
el servicio de archivos estaticos. La configuracion publica se conserva identica en
dashboard/.streamlit/config.toml para ejecucion local y .streamlit/config.toml de la
raiz del repositorio backend para hosting que arranca desde esa raiz. Al cambiarla,
mantener ambos archivos sincronizados. No mover secrets.toml a una carpeta publica.

Consulta únicamente `public.telemetria` a través del backend. No instala tablas,
no escribe mediciones y no envía correos. React incorpora una sección desplegable
«Análisis de sensores» bajo el monitoreo y AgroBot, con iframe, recarga y enlace alternativo.

## Contenido

- Fechas inclusivas en hora de Lima, hasta 366 días por consulta.
- Gráficas escalonadas de temperatura y humedad; referencia de 30 °C.
- Cantidad de cambios, temperatura mínima/máxima y cruces observados hacia >30 °C.
- Última fecha del periodo, tabla desplegable y CSV del conjunto cargado.
- Manejo explícito de datos vacíos, errores, fechas inválidas y resultados parciales.

La tabla contiene cambios, no muestras a intervalo fijo. No se calculan promedios
simples ni disponibilidad del ESP32. Las líneas suponen permanencia del último
valor entre registros; no demuestran que el equipo siguiera conectado. El primer
punto alto no se cuenta como cruce si no conocemos el anterior dentro del periodo.
Estos cruces no equivalen a correos aceptados o entregados. La gráfica no extiende
el último punto hasta el presente. Los IDs pueden tener saltos.

No se puede distinguir automáticamente datos físicos, pruebas manuales o humedad
ambiental histórica porque telemetria no contiene esa clasificación. Seleccionar
el periodo real del YL-69 para interpretar humedad como escala relativa del suelo.
Si se cargan 10.000 cambios se avisa que las métricas/CSV son parciales y se solicita
reducir el periodo; nunca se presenta ese conjunto como historial completo.

## Acceso

Desde el 25 de noviembre de 2026 el dashboard abre directamente, sin contraseña
adicional. `DASHBOARD_PASSWORD` ya no se utiliza y puede retirarse de los secretos.
El login de React no protege la URL independiente de Streamlit: cualquier persona
que acceda a esa URL podrá consultar las métricas y descargar el CSV. Cerrar sesión
en React oculta el panel, pero no revoca ese acceso directo.

La clave `ANALISIS_API_TOKEN` va solo del servidor Streamlit al backend, en cabecera
Bearer. Es distinta del token del ESP32 y del secreto del webhook. No se transmite
en URLs, React, archivos Vite o descargas. Supabase sigue configurado solo en Render.
`config.h` del ESP32 no cambia y no necesita este nuevo token.

## Ejecutar en Windows

1. Generar un nuevo token aleatorio de 64 caracteres hexadecimales en una terminal
   privada o gestor de contraseñas. No copiarlo al chat ni a documentación.
2. Agregar manualmente `ANALISIS_API_TOKEN` a `backend/.env`. Ejecutar el backend
   actualizado con `npm start` desde backend. El resto de integraciones conserva
   su configuración. No es necesario insertar mediciones para abrir el dashboard.
3. Desde `backend/dashboard`, crear un entorno Python e instalar:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   Copy-Item .streamlit/secrets.example.toml .streamlit/secrets.toml
   ```

4. Completar `.streamlit/secrets.toml` (ignorado por Git):

   ```toml
   API_BASE_URL = "http://localhost:3000"
   ANALISIS_API_TOKEN = "RELLENAR_CON_EL_MISMO_TOKEN_PRIVADO_DEL_BACKEND"
   ```

   No reutilizar los placeholders. El servicio permanece cerrado hasta completar
   los valores privados. Variables del entorno del proceso tienen prioridad sobre
   secrets.toml. Se exige HTTPS para servidores remotos; HTTP solo para loopback.

5. Desde la misma carpeta, iniciar:

   ```powershell
   .\.venv\Scripts\python.exe -m streamlit run app.py --server.address 127.0.0.1
   ```

   En este equipo ya existe un entorno validado fuera de Git; para evitar reinstalar:

   ```powershell
   ..\..\.local\dashboard-venv\Scripts\python.exe -m streamlit run app.py --server.address 127.0.0.1
   ```

6. En `frontend/frontend-react/.env.local`, mantener la API deseada y agregar:

   ```dotenv
   VITE_STREAMLIT_URL=http://localhost:8501
   ```

   Reiniciar Vite con `npm run dev`. Entrar a AgroValle, abrir «Ver análisis» e
   explorar directamente los datos del dashboard. En desarrollo se usa
   localhost:8501 por defecto si no se define URL; en producción no hay ese fallback.
   El tema del iframe se fija al abrir la sesión de la página para evitar perder
   filtros al alternar el tema de React. Streamlit también permite su propio tema.

## Endpoint de solo lectura

```text
GET /api/analisis?desde=2026-11-01T05:00:00.000Z&hasta=2026-11-25T05:00:00.000Z&limite=500
Authorization: Bearer <ANALISIS_API_TOKEN>
```

Fechas UTC ISO, desde inclusivo y hasta exclusivo; periodo máximo 366 días. Filtra
el `DISPOSITIVO_ID` configurado; el cliente no elige tabla ni otro dispositivo.
Devuelve planta, lecturas y `siguiente_cursor` (ID). Repetir filtros y añadir
`cursor=<siguiente_cursor>` hasta null. Cada página tiene hasta 500 registros y
se ordena por ID descendente; la interfaz ordena por fecha e ID para graficar.
No se reutiliza `/api/historial`, que conserva su límite y comportamiento actual.
401: token incorrecto; 503: configuración o consulta; 400: filtros inválidos.
Respuestas sin caché HTTP; caché de Streamlit de 30 segundos, limitada a 32 entradas.
Botón Actualizar invalida la caché. No hay consultas automáticas periódicas.

## Publicación manual

1. Revisar/commit/push cuando se autorice. En Render configurar `ANALISIS_API_TOKEN`
   y desplegar el backend que incorpora `/api/analisis`. Mantener todas las variables
   actuales de Supabase, Resend, Gemini, ESP32 y webhook.
2. Desplegar el servicio Python por separado. En Streamlit Community Cloud seleccionar
   el repositorio backend y archivo `dashboard/app.py`; sus dependencias están en
   `dashboard/requirements.txt`. Configurar los dos valores en Settings →
   Secrets: API_BASE_URL de Render y ANALISIS_API_TOKEN. No publicar
   secrets.toml. Para otro hosting: instalar requisitos y ejecutar Streamlit con
   `--server.address 0.0.0.0 --server.port <puerto_del_servicio>`.
3. Community Cloud permite iframe de apps públicas. Esta aplicación no pide
   contraseña: publicar su URL habilita la consulta directa de las métricas y CSV.
   No basarse en una app privada de Community Cloud para iframe,
   cuya incrustación no tiene soporte oficial. No desactivar CORS ni XSRF de Streamlit.
4. En Vercel agregar `VITE_STREAMLIT_URL=https://<servicio-streamlit>` sin parámetros,
   usuarios, contraseña ni token. Mantener VITE_API_URL en Render y recompilar frontend.
   Sin URL válida la sección muestra que el análisis no está habilitado; monitoreo,
   chat y reportes siguen disponibles. Vercel no ejecuta este servidor Python dentro
   de la compilación React: el iframe conecta al servicio adicional.
5. Comprobar acceso, fechas, estados vacíos y ausencia de escrituras en una prueba
   de solo lectura. Pendiente: validar el iframe con URLs y políticas reales del hosting.

Reversión: retirar VITE_STREAMLIT_URL y recompilar o volver al deploy anterior del
frontend; detener el servicio Streamlit y retirar su token si se abandona. El backend
puede conservar el endpoint de lectura sin afectar los demás. No revertir la migración
de telemetría ni borrar filas para retirar el dashboard.

Fuentes: [incrustación oficial](https://docs.streamlit.io/deploy/streamlit-community-cloud/share-your-app/embed-your-app),
[gestión de secretos](https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/secrets-management).

## Validación realizada

Las verificaciones de contraseña descritas abajo corresponden a la versión anterior.
La prueba AppTest actual verifica apertura y gráficas sin contraseña, con cliente
simulado; mantiene el bloqueo de consultas cuando falta configuración del backend.

Windows, Python 3.10, Streamlit 1.65.0 y versiones fijadas en requirements.txt.

- 52 pruebas Node aprobadas (incluyen cuatro del endpoint de análisis).
- 9 pruebas Python aprobadas, con datos simulados y Streamlit AppTest real: acceso,
  gráficas, métricas, paginación, datos vacíos/inválidos y exportación.
- Prueba de URL del iframe, compilación Vite y lint aprobados.
- Chrome: 37 comprobaciones de React con iframe simulado, incluidas regresiones;
  otras 16 con React y Streamlit reales dentro del iframe y API local simulada.
  Estas últimas verificaron formulario, ausencia de consultas sin acceso, cuatro
  métricas, dos gráficas Plotly, lectura GET, móvil, cierre de acceso y logout React.
- Sin consultas a Supabase, correos, commits, push o despliegues reales durante estas pruebas.

Repetir las pruebas versionadas desde sus carpetas respectivas:

```powershell
# backend
npm test
# backend/dashboard (con el entorno Python instalado)
.\.venv\Scripts\python.exe -m unittest -v test_dashboard
# frontend/frontend-react
npm run build
npm run lint
node --test test/analisis-url.test.mjs
```
