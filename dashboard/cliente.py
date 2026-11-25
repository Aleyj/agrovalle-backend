"""Solo HTTP GET; sin credenciales ni acceso directo a Supabase."""
from urllib.parse import urlsplit
import requests


class ErrorAnalisis(Exception):
    pass


def url_api(base):
    u = urlsplit(base)
    local = u.hostname in ("localhost", "127.0.0.1", "::1")
    if (u.scheme != "https" and not (u.scheme == "http" and local)) or not u.hostname or u.username or u.password or u.query or u.fragment:
        raise ErrorAnalisis("La URL de la API no es válida.")
    return base.rstrip("/") + "/api/analisis"


def obtener_lecturas(base, token, desde, hasta, get=None, max_paginas=20):
    get = get or requests.get
    url = url_api(base)
    filas, vistos, cursores = [], set(), set()
    cursor, planta = None, None
    for _ in range(max_paginas):
        params = {"desde": desde, "hasta": hasta, "limite": 500}
        if cursor is not None:
            params["cursor"] = cursor
        try:
            r = get(url, params=params, headers={"Authorization": f"Bearer {token}"},
                    timeout=(10, 60), allow_redirects=False)
            if r.status_code in (401, 403):
                raise ErrorAnalisis("El servicio de análisis no tiene acceso a la API. Revisa su configuración privada.")
            if r.status_code != 200:
                raise ErrorAnalisis(f"La API de análisis no está disponible (HTTP {r.status_code}).")
            body = r.json()
        except (requests.RequestException, ValueError):
            raise ErrorAnalisis("No se pudo consultar la API de análisis. Inténtalo de nuevo.") from None
        if not isinstance(body, dict) or body.get("ok") is not True or not isinstance(body.get("lecturas"), list):
            raise ErrorAnalisis("La API devolvió una respuesta de análisis no válida.")
        actual = body.get("planta")
        if not isinstance(actual, dict) or not actual.get("dispositivo_id") or planta is not None and actual != planta:
            raise ErrorAnalisis("La API no pudo confirmar la planta consultada.")
        planta = actual
        pagina = body["lecturas"]
        if len(pagina) > 500:
            raise ErrorAnalisis("La API devolvió una página demasiado grande.")
        for fila in pagina:
            if not isinstance(fila, dict) or type(fila.get("id")) is not int or fila["id"] <= 0 or fila.get("dispositivo_id") != planta["dispositivo_id"]:
                raise ErrorAnalisis("Se recibió una lectura no válida.")
            if fila["id"] in vistos or cursor is not None and fila["id"] >= cursor:
                raise ErrorAnalisis("La paginación de lecturas no es consistente.")
            vistos.add(fila["id"])
            filas.append(fila)
        siguiente = body.get("siguiente_cursor")
        if siguiente is None:
            return {"planta": planta, "lecturas": filas, "incompleto": False}
        if type(siguiente) is not int or siguiente <= 0 or siguiente in cursores or not pagina or siguiente != pagina[-1]["id"]:
            raise ErrorAnalisis("No se pudo continuar la paginación de lecturas.")
        cursores.add(siguiente)
        cursor = siguiente
    return {"planta": planta, "lecturas": filas, "incompleto": True}
