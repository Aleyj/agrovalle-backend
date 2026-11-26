"""Métricas de cambios observados: no asume muestreo continuo ni entrega de correo."""
import math
import pandas as pd


def preparar(filas):
    columnas = ["id", "dispositivo_id", "temperatura", "humedad", "bomba_encendida", "fecha_hora"]
    df = pd.DataFrame(filas).reindex(columns=columnas)
    # Supabase puede mezclar timestamps ISO con/sin fracciones y distintos offsets.
    # La inferencia de un unico formato descartaba fechas validas del mismo lote.
    df["fecha_hora"] = pd.to_datetime(df["fecha_hora"], format="ISO8601", utc=True, errors="coerce")
    omitidas = int(df["fecha_hora"].isna().sum())
    df = df.dropna(subset=["fecha_hora"]).copy()
    for campo in ("temperatura", "humedad"):
        df[campo] = pd.to_numeric(df[campo], errors="coerce")
        df.loc[~df[campo].map(lambda n: pd.notna(n) and math.isfinite(n)), campo] = float("nan")
    df.loc[~df["humedad"].between(0, 100), "humedad"] = float("nan")
    return df.sort_values(["fecha_hora", "id"]).reset_index(drop=True), omitidas


def cruces_observados(df):
    # No cuenta el primer punto alto como un cruce sin conocer su estado previo.
    t = df["temperatura"]
    return df.loc[t.ge(30) & t.shift(1).lt(30)].copy()


def csv_seguro(df):
    copia = df.copy()
    copia["dispositivo_id"] = copia["dispositivo_id"].map(
        lambda s: "'" + s if isinstance(s, str) and s.startswith(("=", "+", "-", "@", "\t", "\r")) else s)
    return copia.to_csv(index=False).encode("utf-8-sig")
