-- PROPUESTA LOCAL. Revisar y aplicar manualmente con autorización en Supabase.
-- Requiere public.telemetria y sus columnas actuales; no borra ni reescribe filas.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.agrovalle_registrar_cambio(
    p_dispositivo_id text,
    p_temperatura numeric,
    p_humedad numeric,
    p_bomba_encendida boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    anterior public.telemetria%ROWTYPE;
    nueva public.telemetria%ROWTYPE;
    existe boolean;
    bomba boolean;
BEGIN
    IF p_dispositivo_id IS NULL OR p_dispositivo_id !~ '^[A-Za-z0-9_-]{1,80}$'
       OR p_temperatura IS NULL OR p_temperatura::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_humedad IS NULL OR p_humedad NOT BETWEEN 0 AND 100 THEN
        RAISE EXCEPTION 'MEDICION_INVALIDA' USING ERRCODE = '22023';
    END IF;

    -- Serializa comparación + INSERT incluso entre varios procesos de Express.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('agrovalle/telemetria/' || p_dispositivo_id, 0));
    SELECT * INTO anterior FROM public.telemetria
    WHERE dispositivo_id = p_dispositivo_id ORDER BY id DESC LIMIT 1;
    existe := FOUND;
    bomba := COALESCE(p_bomba_encendida, anterior.bomba_encendida, false);

    IF existe AND anterior.temperatura IS NOT DISTINCT FROM p_temperatura
       AND anterior.humedad IS NOT DISTINCT FROM p_humedad
       AND anterior.bomba_encendida IS NOT DISTINCT FROM bomba THEN
        RETURN pg_catalog.jsonb_build_object('registrado', false, 'lectura', pg_catalog.to_jsonb(anterior), 'anterior', pg_catalog.to_jsonb(anterior));
    END IF;

    INSERT INTO public.telemetria (dispositivo_id, temperatura, humedad, bomba_encendida, fecha_hora)
    VALUES (p_dispositivo_id, p_temperatura, p_humedad, bomba,
        GREATEST(pg_catalog.clock_timestamp(), anterior.fecha_hora + interval '1 millisecond'))
    RETURNING * INTO nueva;
    RETURN pg_catalog.jsonb_build_object('registrado', true, 'lectura', pg_catalog.to_jsonb(nueva),
        'anterior', CASE WHEN existe THEN pg_catalog.to_jsonb(anterior) ELSE NULL END);
END;
$$;

REVOKE ALL ON FUNCTION public.agrovalle_registrar_cambio(text, numeric, numeric, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agrovalle_registrar_cambio(text, numeric, numeric, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.agrovalle_proteger_historial()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'El historial es inmutable; registre una nueva medicion.' USING ERRCODE = '55000';
END;
$$;

-- Solo sustituye este trigger propio si ya se instaló la misma propuesta.
DROP TRIGGER IF EXISTS agrovalle_historial_inmutable ON public.telemetria;
CREATE TRIGGER agrovalle_historial_inmutable BEFORE UPDATE OR DELETE ON public.telemetria
FOR EACH ROW EXECUTE FUNCTION public.agrovalle_proteger_historial();

COMMIT;
