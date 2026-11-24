# Una planta, un ESP32 y un historial de cambios

22 de noviembre de 2026. Implementación local para revisar; sin dashboard, firmware,
commit, push, despliegue ni cambios en la base publicada.

## Regla de negocio

Existe una planta asociada a un único identificador lógico de ESP32. Cada fila de
`telemetria` representa el estado de ese mismo equipo después de un cambio.
La primera lectura crea el estado inicial. Después solo se inserta otra fila cuando
cambia temperatura, humedad o bomba. La comparación es exacta, sin redondeo o filtro
de ruido. Una repetición consecutiva de los mismos valores no crea otro log.

Ejemplo: 22 °C / 60 % → repetición idéntica → humedad 65 % → temperatura 35 °C.
Resultado: tres filas; el panel muestra una planta con 35 °C y 65 %.
Cambiar solo la bomba también registra una fila. Omitirla conserva su estado anterior;
en la primera medición, si falta, se usa `false`. Temperatura y humedad son obligatorias.

Cada fila conserva su ID, identificador de dispositivo, temperatura, humedad, bomba
y fecha del cambio generada en la base de datos. No se aceptan ID o fecha impuestos
por el cliente. Cambiar nuevamente a un valor anterior sí registra otro evento.
Las lecturas se ordenan por ID creciente de recepción; no se implementa todavía
ordenación por secuencias del firmware ni detección de reintentos atrasados.

## Endpoints

- `POST /api/telemetria`: valida el único ESP32, registra un cambio mediante RPC y
  devuelve `ok`, `mensaje`, `registrado`, `lectura` y `campos_cambiados`.
- `GET /api/estado`: devuelve `{ ok, planta: { nombre, dispositivo_id }, lectura }`.
  La lectura es el último log del ESP32 configurado o `null` cuando no hay datos.
- `GET /api/historial`: conserva el contrato de array y devuelve los últimos 20
  logs del mismo equipo, ordenados por ID descendente. El almacenamiento no se
  limita a 20 filas; ese es el límite de esta consulta, sin paginación nueva.
- `POST /api/reporte`: conserva HTML y proveedor de correo; usa los últimos 10
  logs de esta planta. No mezcla filas antiguas de otros dispositivos.
- AgroBot y login conservan sus funciones. `local-validacion.js` admite lectura
  de estado e historial, mantiene bloqueada la ingestión y prepara correo en memoria.

Ejemplo de cuerpo de medición (no se envió):

```json
{
  "dispositivo_id": "ESP32-AGRO-01",
  "temperatura": 22.5,
  "humedad": 61,
  "bomba_encendida": false
}
```

El identificador puede omitirse y se usa el configurado. Uno diferente devuelve 409.
Datos inválidos devuelven 400. La identidad fija es una regla del modelo, no una
autenticación física del ESP32: la autenticación de ingestión sigue pendiente para
la futura conexión de hardware; este cambio no habilita ni programa esa conexión.

## Persistencia y SQL pendiente de aplicar

`sql/001_telemetria_cambios.sql` añade una función RPC transaccional. La comparación
con el último log y el INSERT se serializan con un advisory lock de transacción por
dispositivo. No se usa un estado en memoria de Express para decidir qué se guarda.
El acceso a la RPC se restringe a `service_role`, utilizado únicamente en el backend.
El SQL también instala un trigger que rechaza UPDATE y DELETE de logs históricos.

Antes de aplicarlo se debe comprobar el esquema real: `public.telemetria` con
ID numérico creciente, dispositivo de texto, temperatura/humedad numéricas, bomba
booleana y `fecha_hora` de tipo timestamp. El SQL usa esas columnas existentes;
no crea tablas nuevas ni convierte tipos. Los campos adicionales deben tener
default o permitir NULL. La clave privada del backend debe disponer de permisos
de consulta, inserción y ejecución de la RPC; nunca colocar esa clave en React/ESP32.

La migración no borra ni reescribe filas antiguas. Las de otros dispositivos se
conservan y quedan fuera de las consultas de esta planta. Las antiguas del mismo
identificador siguen formando parte del historial; no se puede reconstruir una
historia que anteriormente fue sobrescrita. Los nuevos cambios pasan a registrarse
sin sobrescribir. Cambiar `PLANTA_NOMBRE` no asigna una nueva planta histórica:
la asociación debe mantenerse estable durante esta etapa del prototipo.

Todas las mediciones nuevas deben pasar por `/api/telemetria` para aplicar la
comparación atómica. Un INSERT manual/directo elude la deduplicación de la RPC.
El trigger impide editar filas desde Table Editor una vez instalado. El antiguo
trigger de `updated_at` ya no es necesario para generar logs; no se elimina
automáticamente ni se depende de él. El registro usa `fecha_hora` nueva en cada INSERT.

Sin la RPC instalada, la ingestión devuelve 503 `TELEMETRIA_MIGRACION_PENDIENTE`.
No hay fallback silencioso que inserte lecturas repetidas. La consulta de datos
existentes no necesita la nueva RPC.

## Alertas

Se alerta al superar 30 °C desde un estado <=30 °C; una primera lectura ya alta
también alerta. Mientras siga alta, cambiar humedad, bomba o subir de 35 a 36 no
repite el correo. Bajar y volver a superar el umbral genera otra alerta.

En modo `webhook`, solo INSERT de `public.telemetria` para el ESP32 configurado
notifica. El receptor consulta el log inmediatamente anterior al ID del evento,
no el último estado global, para conservar la decisión al reentregar eventos.
UPDATE/DELETE y otros dispositivos se omiten. El modo `express` evalúa el mismo
cruce a partir del estado anterior devuelto por la RPC; el webhook permanece
desactivado en ese modo, evitando dos fuentes simultáneas.

La idempotencia usa el ID del log y la ventana de 24 horas de Resend. Aceptación
no confirma entrega. No se añaden cola de reintentos ni ledger de entregas en esta
fase; los registros permiten reconstruir cruces de temperatura, pero no acreditar
que se entregó un correo. El futuro dashboard requerirá distinguir estos conceptos.

## Activación futura, no ejecutada

1. Revisar el esquema y el SQL con el administrador y registrar el despliegue actual.
2. Configurar `DISPOSITIVO_ID` (por defecto `ESP32-AGRO-01`) y `PLANTA_NOMBRE`
   (por defecto `Mi planta`) en el backend. Mantenerlos estables y conservar las
   credenciales existentes. No cambiar `.env` ni el panel desde esta preparación.
3. Aplicar el SQL autorizado antes de publicar el backend nuevo.
4. Conservar `ALERT_TRIGGER=webhook` si ese es el flujo elegido, los destinatarios,
   Resend y el secreto del webhook. Configurar el Database Webhook solo para INSERT;
   no fabricar lecturas para comprobarlo sin autorización de registro y correo.
5. Publicar backend, comprobar estado e historial en lectura y después frontend,
   que ahora consulta `/api/estado` cada cinco segundos. El cliente muestra una sola
   tarjeta y no agrega tabla, gráficos, promedios ni dashboard.

Reversión: coordinar versiones de frontend/backend y webhook. Eliminar únicamente
el trigger propio `agrovalle_historial_inmutable` si se autoriza volver al modelo
editable; no borrar logs ni ejecutar una limpieza de filas. Conservar la función RPC
es compatible con el rollback de código. El rollback de código no restaura por sí
solo las reglas de edición de Supabase.

## Validación y límites

Resultado final: 47 pruebas de backend aprobadas, 13 comprobaciones SQL aprobadas,
31 comprobaciones de Chrome aprobadas, build y lint frontend correctos. La auditoría
de archivos versionables no detectó coincidencias sensibles con los controles usados.
Evidencias locales ignoradas:
`evidencia/pruebas-planta-unica.tap`, `evidencia/sql-planta-unica.json` y, fuera de
ambos repositorios, `.local/frontend-simple-validacion.json`. El verificador SQL
local está en `.local/validar-sql-planta.cjs`; PGlite se instaló solo en
`.local/pg-validacion`, sin modificar dependencias de frontend/backend.

Se probaron rutas HTTP, contratos, validación, deduplicación, identidad única,
aislamiento de consultas, alertas, reportes y regresiones con servicios simulados.
Además se ejecutó el SQL en PostgreSQL embebido PGlite 0.5.17 en memoria, con un
esquema representativo y sin conectarse a Supabase. Se verificaron instalación,
preservación de filas, snapshots, duplicados, fechas, permisos RPC e inmutabilidad.
PGlite usa una conexión; esa prueba no acredita concurrencia entre procesos ni
el esquema, RLS, pg_net o credenciales del proyecto real. La revisión real del
esquema y la activación autorizada siguen pendientes.

Este historial guarda cambios, no muestras a intervalos constantes. Un promedio
aritmético de las filas no representa necesariamente el promedio temporal del
cultivo; el futuro dashboard deberá tener en cuenta las duraciones de cada estado.
No se implementan aún agregaciones ni visualizaciones.

Referencias: [RPC Supabase](https://supabase.com/docs/reference/javascript/rpc),
[funciones de base de datos](https://supabase.com/docs/guides/database/functions),
[advisory locks PostgreSQL](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS).
