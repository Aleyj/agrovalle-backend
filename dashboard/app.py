import os
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import plotly.express as px
import streamlit as st

from cliente import ErrorAnalisis, obtener_lecturas
from metricas import preparar, cruces_observados, csv_seguro

st.set_page_config(page_title="Análisis · AgroValle", page_icon="🌱", layout="wide")


def config(nombre):
    valor = os.environ.get(nombre)
    if valor is None:
        try:
            valor = st.secrets.get(nombre, "")
        except (FileNotFoundError, st.errors.StreamlitSecretNotFoundError):
            valor = ""
    return str(valor).strip()


base = config("API_BASE_URL")
token = config("ANALISIS_API_TOKEN")
if not base or len(token) < 32 or token.startswith("RELLENAR"):
    st.info("El servicio de análisis aún no está configurado.")
    st.stop()

@st.cache_data(ttl=30, max_entries=32, show_spinner=False)
def consultar(api, credencial, desde, hasta):
    return obtener_lecturas(api, credencial, desde, hasta)


st.title("🌱 Análisis del cultivo")
st.caption("Temperatura y humedad · Hora de Lima")
zona = ZoneInfo("America/Lima")
hoy = datetime.now(zona).date()
c1, c2, c3 = st.columns([2, 2, 1])
inicio = c1.date_input("Desde", hoy - timedelta(days=7))
fin = c2.date_input("Hasta", hoy)
if c3.button("Actualizar"):
    consultar.clear()
if inicio > fin or (fin - inicio).days >= 366:
    st.warning("Selecciona un periodo válido de hasta 366 días.")
    st.stop()
desde = datetime.combine(inicio, time.min, zona).astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
hasta = datetime.combine(fin + timedelta(days=1), time.min, zona).astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
try:
    with st.spinner("Consultando cambios registrados…"):
        resultado = consultar(base, token, desde, hasta)
except ErrorAnalisis as error:
    st.error(str(error))
    st.stop()
except Exception:
    st.error("No se pudo preparar el análisis. Revisa el servicio e inténtalo de nuevo.")
    st.stop()

planta = resultado["planta"]
st.subheader(f"{planta.get('nombre', 'Mi planta')} · {planta['dispositivo_id']}")
if resultado["incompleto"]:
    st.warning("Se alcanzó el límite de 10.000 cambios. Los resultados son parciales: reduce el periodo.")
df, omitidas = preparar(resultado["lecturas"])
if omitidas:
    st.warning(f"Se omitieron {omitidas} registros sin fecha válida.")
if df.empty:
    st.info("No hay cambios registrados en este periodo.")
    st.stop()

cruces = cruces_observados(df)
def grados(valor):
    return "Sin dato" if valor != valor else f"{valor:.1f} °C"

m1, m2, m3, m4 = st.columns(4)
m1.metric("Cambios registrados", len(df))
m2.metric("Temperatura mínima", grados(df["temperatura"].min()))
m3.metric("Temperatura máxima", grados(df["temperatura"].max()))
m4.metric("Cruces observados ≥30 °C", len(cruces))
with st.expander("Cómo interpretar estos datos"):
    st.write("El historial guarda los cambios detectados. Cada escalón mantiene el último valor registrado hasta el siguiente cambio; durante ese intervalo no podemos confirmar si el dispositivo estuvo conectado.")
    st.write("Los cruces indican subidas de menos de 30 °C a 30 °C o más entre registros del periodo. El primer punto alto no confirma un cruce. Este conteo no indica cuántos correos se entregaron.")
    st.write("La humedad del suelo es una escala relativa calibrada con el YL-69. Si existen pruebas manuales o lecturas antiguas de humedad ambiental, selecciona las fechas de las mediciones que quieras analizar.")
grafico = df.copy()
grafico["fecha_hora"] = grafico["fecha_hora"].dt.tz_convert(zona)
for campo, titulo, unidad in [("temperatura", "Temperatura del aire", "°C"), ("humedad", "Humedad registrada", "%")]:
    fig = px.line(grafico, x="fecha_hora", y=campo, markers=True, line_shape="hv",
                  labels={"fecha_hora": "Fecha y hora (Lima)", campo: unidad}, title=titulo)
    fig.update_traces(connectgaps=False, line_color="#208456" if campo == "temperatura" else "#a7803d", line_width=3, marker_size=6)
    fig.update_layout(font_family="Manrope, sans-serif", paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)", margin=dict(l=12, r=18, t=55, b=20))
    if campo == "temperatura":
        fig.add_hline(y=30, line_dash="dash", line_color="#c45430", annotation_text="Umbral 30 °C")
    else:
        fig.update_yaxes(range=[0, 100])
    st.plotly_chart(fig, width="stretch")
st.write("Último cambio del periodo:", grafico.iloc[-1]["fecha_hora"].strftime("%d/%m/%Y %H:%M:%S"))
with st.expander("Ver cambios del periodo y descargar"):
    tabla = grafico.copy()
    tabla["fecha_hora"] = tabla["fecha_hora"].dt.strftime("%Y-%m-%d %H:%M:%S %z")
    st.dataframe(tabla, hide_index=True, width="stretch")
    st.download_button("Descargar CSV", csv_seguro(tabla), "agrovalle-cambios.csv", "text/csv")
