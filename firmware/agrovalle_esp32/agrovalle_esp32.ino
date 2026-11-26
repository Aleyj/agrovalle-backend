#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <time.h>
#include <math.h>
#include "config.h"
#include "certificado_ca.h"

DHT dht(PIN_DHT, DHT22);
Preferences preferencias;
bool enviando = false;
bool bloqueado = false;
int sueloSeco = -1;
int sueloHumedo = -1;
String pendiente;
unsigned long siguiente = 0;
unsigned long espera = INTERVALO_MS;
unsigned long ultimaConexion = 0;

int leerSuelo() {
  long suma = 0;
  for (int i = 0; i < 32; ++i) {
    suma += analogRead(PIN_SUELO);
    delay(3);
  }
  return suma / 32;
}

bool calibrado() {
  return sueloSeco >= 0 && sueloHumedo >= 0 && abs(sueloSeco - sueloHumedo) >= 200;
}

void comandos() {
  while (Serial.available()) {
    const char c = Serial.read();
    if (c == 'x') {
      enviando = false;
      pendiente = "";
      Serial.println("Envio detenido. Sin nuevas solicitudes de telemetria.");
    }
    if (c == 's' || c == 'h') {
      if (enviando) {
        Serial.println("Primero pulsa x para detener el envio y calibrar.");
        continue;
      }
      const int valor = leerSuelo();
      if (c == 's') { sueloSeco = valor; preferencias.putInt("seco", valor); }
      else { sueloHumedo = valor; preferencias.putInt("humedo", valor); }
      Serial.printf("Calibracion %s: ADC=%d\n", c == 's' ? "seco" : "humedo", valor);
    }
    if (c == 'e') {
      if (!calibrado()) {
        Serial.println("Falta calibrar s y h; deben diferir al menos 200 unidades ADC.");
        continue;
      }
      if (strstr(TELEMETRIA_TOKEN, "RELLENAR") || strlen(TELEMETRIA_TOKEN) < 32) {
        Serial.println("Completa el token privado en config.h y vuelve a cargar.");
        continue;
      }
      enviando = true;
      bloqueado = false;
      siguiente = millis();
      espera = INTERVALO_MS;
      Serial.println("Envio habilitado: escribira mediciones REALES. Temperatura >=30 o suelo <30% pueden generar correo.");
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  dht.begin();
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_SUELO, ADC_11db);
  preferencias.begin("agrovalle", false);
  sueloSeco = preferencias.getInt("seco", -1);
  sueloHumedo = preferencias.getInt("humedo", -1);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  Serial.println("AgroValle: envio DETENIDO al arrancar.");
  Serial.println("s=calibrar suelo seco; h=calibrar suelo humedo; e=enviar; x=detener.");
  Serial.println("El porcentaje es una escala relativa calibrada, no humedad volumetrica.");
}

void loop() {
  comandos();
  if (static_cast<long>(millis() - siguiente) < 0) { delay(20); return; }
  siguiente = millis() + INTERVALO_MS;

  const int adc = leerSuelo();
  const float temperatura = dht.readTemperature();
  const float humedad = calibrado()
    ? constrain(100.0f * (adc - sueloSeco) / (sueloHumedo - sueloSeco), 0.0f, 100.0f) : NAN;
  Serial.printf("ADC=%d; temperatura=%.1f C; suelo=%.0f %% (relativo); WiFi=%s\n",
                adc, temperatura, humedad, WiFi.status() == WL_CONNECTED ? "OK" : "sin conexion");
  if (!enviando || bloqueado) return;
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - ultimaConexion >= 30000) { ultimaConexion = millis(); WiFi.reconnect(); }
    Serial.println("Esperando WiFi; no se confirma guardado.");
    return;
  }
  if (time(nullptr) < 1735689600) {
    Serial.println("Esperando hora NTP para verificar certificado TLS.");
    return;
  }
  if (pendiente.isEmpty()) {
    if (!isfinite(temperatura) || temperatura < -40 || temperatura > 80 || !isfinite(humedad)) {
      Serial.println("Lectura invalida: no se envia ni se sustituye por cero.");
      return;
    }
    JsonDocument datos;
    datos["dispositivo_id"] = DISPOSITIVO_ID;
    datos["temperatura"] = roundf(temperatura * 10) / 10;
    datos["humedad"] = static_cast<int>(roundf(humedad));
    // No controlar bomba ni imponer fecha/ID: el backend conserva esos valores.
    serializeJson(datos, pendiente);
  }

  WiFiClientSecure cliente;
  cliente.setCACert(AGROVALLE_ROOT_CA);
  cliente.setHandshakeTimeout(20);
  HTTPClient http;
  http.setConnectTimeout(15000);
  http.setTimeout(60000);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if (!http.begin(cliente, API_URL)) {
    Serial.println("No se pudo iniciar HTTPS; revisa API_URL.");
    return;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + TELEMETRIA_TOKEN);
  const int estado = http.POST(pendiente);
  JsonDocument respuesta;
  bool confirmado = false;
  if (estado == 200) {
    const auto error = deserializeJson(respuesta, http.getString());
    confirmado = !error && respuesta["ok"].is<bool>() && respuesta["ok"].as<bool>()
      && respuesta["registrado"].is<bool>();
  }
  if (confirmado) {
    Serial.println(respuesta["registrado"].as<bool>()
      ? "HTTP 200: cambio registrado en Supabase."
      : "HTTP 200: sin cambios; no se agrego otra fila.");
    pendiente = "";
    espera = INTERVALO_MS;
  } else {
    Serial.printf("Sin confirmar guardado; HTTP/codigo transporte=%d.\n", estado);
    // No imprimir cabeceras, token, password ni cuerpo de error remoto.
    if (estado >= 400 && estado < 500 && estado != 408 && estado != 429) {
      bloqueado = true;
      Serial.println("Envio pausado: revisar token (401), dispositivo (409) o datos (400). Pulsa e tras corregir.");
    }
    espera = min(espera * 2, 300000UL);
  }
  http.end();
  siguiente = millis() + espera;
  // Ante fallo se reintenta el mismo JSON en RAM antes de tomar otro para enviar.
}
