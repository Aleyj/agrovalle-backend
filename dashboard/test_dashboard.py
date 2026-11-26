import os
import unittest
from unittest.mock import patch

from cliente import obtener_lecturas, ErrorAnalisis, url_api
from metricas import preparar, cruces_observados, csv_seguro


def fila(i, t, fecha=None):
    return dict(id=i, dispositivo_id="ESP32-AGRO-01", temperatura=t, humedad=45,
                bomba_encendida=False, fecha_hora=fecha or f"2026-11-24T12:{i:02d}:00Z")


class Respuesta:
    status_code = 200
    def __init__(self, rows, cursor=None):
        self.rows, self.cursor = rows, cursor
    def json(self):
        return dict(ok=True, planta=dict(nombre="Mi planta", dispositivo_id="ESP32-AGRO-01"),
                    lecturas=self.rows, siguiente_cursor=self.cursor)


class AnalisisTests(unittest.TestCase):
    def test_paginacion_solo_get_y_cabecera_no_url(self):
        llamadas = []
        def get(url, **kwargs):
            llamadas.append((url, kwargs))
            return Respuesta([fila(2, 35)], 2) if len(llamadas) == 1 else Respuesta([fila(1, 29)])
        r = obtener_lecturas("https://api.example.invalid", "TOKEN_PRIVADO", "desde", "hasta", get)
        self.assertEqual([f["id"] for f in r["lecturas"]], [2, 1])
        self.assertFalse(r["incompleto"])
        self.assertNotIn("TOKEN_PRIVADO", llamadas[0][0])
        self.assertEqual(llamadas[1][1]["params"]["cursor"], 2)
        self.assertFalse(llamadas[0][1]["allow_redirects"])

    def test_limite_de_paginas_se_marca_parcial(self):
        r = obtener_lecturas("http://127.0.0.1:3000", "token", "d", "h", lambda *a, **k: Respuesta([fila(2, 35)], 2), max_paginas=1)
        self.assertTrue(r["incompleto"])

    def test_rechaza_url_insegura_y_respuesta_de_otro_dispositivo(self):
        for url in ("http://remoto.example", "https://usuario:password@example.com", "https://example.com?token=privado"):
            with self.assertRaises(ErrorAnalisis): url_api(url)
        mala = fila(1, 25)
        mala["dispositivo_id"] = "otro"
        with self.assertRaises(ErrorAnalisis):
            obtener_lecturas("https://api.example.invalid", "token", "d", "h", lambda *a, **k: Respuesta([mala]))

    def test_http_error_no_filtra_cuerpo_privado(self):
        r = Respuesta([])
        r.status_code = 401
        with self.assertRaises(ErrorAnalisis) as error:
            obtener_lecturas("https://api.example.invalid", "token", "d", "h", lambda *a, **k: r)
        self.assertNotIn("token", str(error.exception))

    def test_fechas_invalidas_humedad_fuera_rango_y_temperatura_nan(self):
        datos = [fila(1, 22), fila(2, float("inf")), fila(3, 35, "invalida")]
        datos[0]["humedad"] = 101
        df, omitidas = preparar(datos)
        self.assertEqual(omitidas, 1)
        self.assertTrue(df["humedad"].isna().iloc[0])
        self.assertTrue(df["temperatura"].isna().iloc[1])
        self.assertEqual(len(cruces_observados(df)), 0)

    def test_cruces_29_30_35_sin_contar_primera_alta_ni_repeticiones(self):
        df, _ = preparar([fila(i+1, t) for i, t in enumerate([35, 29, 30, 35, 30, 29, 30])])
        self.assertEqual(cruces_observados(df)["id"].tolist(), [3, 7])

    def test_fechas_iso_con_fracciones_y_zonas_distintas_no_se_omiten(self):
        fechas = ["2026-11-25T11:00:00+00:00", "2026-11-25T11:30:00.123456+00:00",
                  "2026-11-25T12:00:00Z", "2026-11-25T07:30:00.123-05:00"]
        for orden in (fechas, list(reversed(fechas))):
            datos = [fila(i + 1, 25, fecha) for i, fecha in enumerate(orden)]
            datos.extend([{**fila(5, 25), "fecha_hora": None}, fila(6, 25, "invalida")])
            df, omitidas = preparar(datos)
            self.assertEqual(len(df), 4)
            self.assertEqual(omitidas, 2)
            self.assertTrue(df["fecha_hora"].is_monotonic_increasing)
            self.assertEqual(str(df["fecha_hora"].dt.tz), "UTC")
            self.assertEqual(df.iloc[-1]["fecha_hora"].isoformat(), "2026-11-25T12:30:00.123000+00:00")

    def test_vacio_y_exportacion(self):
        df, n = preparar([])
        self.assertTrue(df.empty)
        self.assertEqual(n, 0)
        df, _ = preparar([fila(1, 22)])
        df.loc[0, "dispositivo_id"] = "=1+1"
        self.assertIn("'=1+1", csv_seguro(df).decode("utf-8-sig"))

    def test_streamlit_muestra_datos_sin_contrasena_con_cliente_simulado(self):
        from streamlit.testing.v1 import AppTest
        app = os.path.join(os.path.dirname(__file__), "app.py")
        env = dict(API_BASE_URL="http://127.0.0.1:9999", ANALISIS_API_TOKEN="token-ficticio-analisis-solo-tests-123456789",
                   DASHBOARD_PASSWORD="")
        # Inyectar el cliente antes de cargar el app evita cualquier consulta de red real.
        with patch.dict(os.environ, env), patch("cliente.obtener_lecturas", return_value={
            "planta": dict(nombre="Mi planta", dispositivo_id="ESP32-AGRO-01"),
            "lecturas": [fila(1, 29), fila(2, 35)], "incompleto": False}) as consultar:
            at = AppTest.from_file(app).run(timeout=30)
            self.assertFalse(at.exception)
            self.assertEqual(len(at.text_input), 0)
            self.assertFalse(any(b.label == "Cerrar acceso al análisis" for b in at.button))
            self.assertEqual(len(at.metric), 4)
            self.assertEqual(len(at.get("plotly_chart")), 2)
            self.assertEqual(at.metric[3].value, "1")
            consultar.assert_called()

    def test_streamlit_configuracion_ausente_no_consulta(self):
        from streamlit.testing.v1 import AppTest
        app = os.path.join(os.path.dirname(__file__), "app.py")
        with patch.dict(os.environ, dict(API_BASE_URL="", ANALISIS_API_TOKEN="", DASHBOARD_PASSWORD="")), patch("cliente.requests.get") as red:
            at = AppTest.from_file(app).run(timeout=30)
            self.assertFalse(at.exception)
            self.assertTrue(at.info)
            red.assert_not_called()


if __name__ == "__main__":
    unittest.main()
