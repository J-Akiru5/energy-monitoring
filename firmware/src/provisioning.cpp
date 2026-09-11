#include "provisioning.h"
#include "config.h"
#include <Preferences.h>
#include <WiFi.h>
#include <WebServer.h>

using namespace EmuCfg;

static Preferences nvs;
static BootState currentBootState = BOOT_UNPROVISIONED;

static String cfgSsid = "";
static String cfgPassword = "";
static String cfgDeviceId = "";
static String cfgDeviceToken = "";
static String cfgApiEndpoint = "";
static String cfgSupabaseHost = "";
static String cfgSupabaseAnonKey = "";
static int cfgPhaseMode = 3;

static WebServer provServer(80);

static const char* PROV_AP_SSID_PREFIX = "EMU-";

static const char* PROV_HTML = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>EMU Setup</title>
<style>
body{font-family:Arial,sans-serif;max-width:420px;margin:40px auto;padding:15px}
h1{color:#1a1a2e;font-size:1.4em;border-bottom:2px solid #0f3460;padding-bottom:8px}
.f{margin-bottom:14px}
label{display:block;margin-bottom:4px;font-weight:bold;font-size:0.9em;color:#333}
input{width:100%;padding:9px;border:1px solid #bbb;border-radius:4px;box-sizing:border-box;font-size:0.95em}
button{width:100%;padding:11px;background:#0f3460;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:1em;font-weight:bold}
button:hover{background:#16213e}
.note{font-size:0.8em;color:#666;margin-top:16px;line-height:1.4}
.err{color:#c0392b;font-size:0.85em;margin-top:4px;display:none}
</style>
</head>
<body>
<h1>EMU Configuration</h1>
<p style="font-size:0.85em;color:#555">Connect this EMU to your network and register it with the backend.</p>
<form id="f" action="/configure" method="POST" onsubmit="return validate()">
<div class="f"><label>WiFi Network Name (SSID)</label><input type="text" name="ssid" id="ssid" required placeholder="e.g. WVSU-Office"></div>
<div class="f"><label>WiFi Password</label><input type="password" name="password" id="password" required></div>
<div class="f"><label>Device ID (UUID from Admin Dashboard)</label><input type="text" name="device_id" id="device_id" required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"><div class="err" id="eid">Enter a valid UUID</div></div>
<div class="f"><label>Device Token (from Admin Dashboard)</label><input type="text" name="device_token" id="device_token" required placeholder="em_xxxxxxxxxxxxxxxx"><div class="err" id="etok">Must start with em_</div></div>
<button type="submit">Configure &amp; Reboot</button>
</form>
<div class="note">After configuration the EMU will reboot automatically and begin normal operation.<br><br><b>Phase Mode:</b> 3-phase (default). Change via serial command after boot if needed.</div>
<script>
function validate(){
var ok=true;
var did=document.getElementById('device_id').value.trim();
var dtok=document.getElementById('device_token').value.trim();
var re=/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
document.getElementById('eid').style.display=(re.test(did)?'none':'block');
if(!re.test(did))ok=false;
document.getElementById('etok').style.display=(dtok.startsWith('em_')?'none':'block');
if(!dtok.startsWith('em_'))ok=false;
return ok;}
</script>
</body>
</html>
)rawliteral";

static const char* PROV_SUCCESS_HTML = R"rawliteral(
<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>EMU Configured</title>
<style>body{font-family:Arial,sans-serif;max-width:400px;margin:60px auto;padding:20px;text-align:center}
h1{color:#27ae60}p{color:#555;line-height:1.6}</style></head>
<body><h1>Configuration Saved</h1>
<p>The EMU will reboot now and connect to your WiFi network.<br><br>
You may disconnect from the EMU setup network.</p></body></html>
)rawliteral";

static void handleProvRoot() {
  provServer.send(200, "text/html", PROV_HTML);
}

static void handleProvConfigure() {
  String ssid = provServer.arg("ssid");
  String password = provServer.arg("password");
  String deviceId = provServer.arg("device_id");
  String deviceToken = provServer.arg("device_token");

  ssid.trim();
  password.trim();
  deviceId.trim();
  deviceToken.trim();

  if (ssid.length() == 0 || deviceId.length() == 0 || deviceToken.length() == 0) {
    provServer.send(400, "text/html", "Missing required fields");
    return;
  }

  Serial.println("[PROV] Saving configuration...");
  nvs.begin(EmuCfg::NVS_NAMESPACE, false);
  nvs.putBool(EmuCfg::KEY_PROVISIONED, true);
  nvs.putString(EmuCfg::KEY_WIFI_SSID, ssid);
  nvs.putString(EmuCfg::KEY_WIFI_PASS, password);
  nvs.putString(EmuCfg::KEY_DEVICE_ID, deviceId);
  nvs.putString(EmuCfg::KEY_DEVICE_TOKEN, deviceToken);
  nvs.putInt(EmuCfg::KEY_PHASE_MODE, 3);
  nvs.end();

  Serial.printf("[PROV] SSID:     %s\n", ssid.c_str());
  Serial.printf("[PROV] DeviceID: %s\n", deviceId.c_str());
  Serial.printf("[PROV] Token:    %s\n", deviceToken.c_str());
  Serial.println("[PROV] Configuration saved. Rebooting in 3s...");

  provServer.send(200, "text/html", PROV_SUCCESS_HTML);
  delay(3000);
  ESP.restart();
}

static void handleProvNotFound() {
  provServer.sendHeader("Location", "/");
  provServer.send(302, "text/plain", "");
}

static String getMacSuffix() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[5];
  snprintf(buf, sizeof(buf), "%04X", (uint16_t)(mac & 0xFFFF));
  return String(buf);
}

bool provisioningInit() {
  nvs.begin(EmuCfg::NVS_NAMESPACE, true);
  bool provisioned = nvs.getBool(EmuCfg::KEY_PROVISIONED, false);

  if (!provisioned) {
    nvs.end();
    return false;
  }

  cfgSsid = nvs.getString(EmuCfg::KEY_WIFI_SSID, "");
  cfgPassword = nvs.getString(EmuCfg::KEY_WIFI_PASS, "");
  cfgDeviceId = nvs.getString(EmuCfg::KEY_DEVICE_ID, "");
  cfgDeviceToken = nvs.getString(EmuCfg::KEY_DEVICE_TOKEN, "");
  cfgApiEndpoint = nvs.getString(EmuCfg::KEY_API_ENDPOINT, API_ENDPOINT_DEFAULT);
  cfgSupabaseHost = nvs.getString(EmuCfg::KEY_SUPABASE_HOST, SUPABASE_HOST_DEFAULT);
  cfgSupabaseAnonKey = nvs.getString(EmuCfg::KEY_SUPABASE_KEY, SUPABASE_KEY_DEFAULT);
  cfgPhaseMode = nvs.getInt(EmuCfg::KEY_PHASE_MODE, 3);
  nvs.end();

  if (cfgSsid.length() == 0 || cfgDeviceId.length() == 0 || cfgDeviceToken.length() == 0) {
    Serial.println("[PROV] NVS marked provisioned but critical fields missing.");
    return false;
  }

  if (cfgPhaseMode != 1 && cfgPhaseMode != 3) {
    cfgPhaseMode = 3;
  }

  return true;
}

bool isProvisioned() {
  return cfgSsid.length() > 0 && cfgDeviceId.length() > 0 && cfgDeviceToken.length() > 0;
}

void enterProvisioningMode() {
  String apSsid = String(PROV_AP_SSID_PREFIX) + getMacSuffix();

  Serial.println("[PROV] ========================================");
  Serial.println("[PROV] PROVISIONING MODE");
  Serial.printf("[PROV] AP SSID:     %s\n", apSsid.c_str());
  Serial.println("[PROV] AP Password: (none - open network)");
  Serial.println("[PROV] URL:         http://192.168.4.1");
  Serial.println("[PROV] ========================================");
  Serial.println("[PROV] Connect to the EMU WiFi network and open a browser.");

  WiFi.mode(WIFI_AP);
  WiFi.softAP(apSsid.c_str(), NULL, 1, 0, 4);

  delay(500);
  Serial.printf("[PROV] AP IP: %s\n", WiFi.softAPIP().toString().c_str());

  provServer.on("/", HTTP_GET, handleProvRoot);
  provServer.on("/configure", HTTP_POST, handleProvConfigure);
  provServer.onNotFound(handleProvNotFound);
  provServer.begin();

  Serial.println("[PROV] Waiting for configuration...");

  while (true) {
    provServer.handleClient();
    delay(10);
  }
}

BootState getBootState() {
  return currentBootState;
}

void setBootState(BootState state) {
  currentBootState = state;
}

const char* getBootStateName(BootState state) {
  switch (state) {
    case BOOT_UNPROVISIONED:      return "UNPROVISIONED";
    case BOOT_CONFIGURED_OFFLINE: return "CONFIGURED_OFFLINE";
    case BOOT_CONFIGURED_ONLINE:  return "CONFIGURED_ONLINE";
    case BOOT_BACKEND_UNAVAILABLE:return "BACKEND_UNAVAILABLE";
    case BOOT_NORMAL_OPERATION:   return "NORMAL_OPERATION";
    case BOOT_PROTECTIVE_TRIP:    return "PROTECTIVE_TRIP";
    default:                      return "UNKNOWN";
  }
}

const String& getConfigSsid()           { return cfgSsid; }
const String& getConfigPassword()       { return cfgPassword; }
const String& getConfigDeviceId()       { return cfgDeviceId; }
const String& getConfigDeviceToken()    { return cfgDeviceToken; }
const String& getConfigApiEndpoint()    { return cfgApiEndpoint; }
const String& getConfigSupabaseHost()   { return cfgSupabaseHost; }
const String& getConfigSupabaseAnonKey(){ return cfgSupabaseAnonKey; }
int getConfigPhaseMode()                { return cfgPhaseMode; }

bool saveWifiConfig(const char* ssid, const char* password) {
  nvs.begin(EmuCfg::NVS_NAMESPACE, false);
  nvs.putString(EmuCfg::KEY_WIFI_SSID, ssid);
  nvs.putString(EmuCfg::KEY_WIFI_PASS, password);
  nvs.putBool(EmuCfg::KEY_PROVISIONED, true);
  nvs.end();
  cfgSsid = ssid;
  cfgPassword = password;
  return true;
}

bool saveDeviceConfig(const char* deviceId, const char* deviceToken) {
  nvs.begin(EmuCfg::NVS_NAMESPACE, false);
  nvs.putString(EmuCfg::KEY_DEVICE_ID, deviceId);
  nvs.putString(EmuCfg::KEY_DEVICE_TOKEN, deviceToken);
  nvs.putBool(EmuCfg::KEY_PROVISIONED, true);
  nvs.end();
  cfgDeviceId = deviceId;
  cfgDeviceToken = deviceToken;
  return true;
}

bool savePhaseMode(int mode) {
  if (mode != 1 && mode != 3) return false;
  nvs.begin(EmuCfg::NVS_NAMESPACE, false);
  nvs.putInt(EmuCfg::KEY_PHASE_MODE, mode);
  nvs.end();
  cfgPhaseMode = mode;
  return true;
}

void factoryReset() {
  Serial.println("[PROV] FACTORY RESET - clearing all configuration...");
  nvs.begin(EmuCfg::NVS_NAMESPACE, false);
  nvs.clear();
  nvs.end();
  Serial.println("[PROV] Configuration cleared. Rebooting...");
  delay(500);
  ESP.restart();
}

void handleSerialCommands() {
  if (!Serial.available()) return;

  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  cmd.toLowerCase();

  if (cmd == "status") {
    Serial.println("[STATUS] ====== EMU STATUS ======");
    Serial.printf("[STATUS] Boot State:     %s\n", getBootStateName(currentBootState));
    Serial.printf("[STATUS] Device ID:      %s\n", cfgDeviceId.c_str());
    Serial.printf("[STATUS] Phase Mode:     %s\n", cfgPhaseMode == 3 ? "3-phase" : "1-phase");
    Serial.printf("[STATUS] WiFi SSID:      %s\n", cfgSsid.c_str());
    Serial.printf("[STATUS] WiFi:           %s\n", WiFi.status() == WL_CONNECTED ? "CONNECTED" : "DISCONNECTED");
    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("[STATUS] IP:             %s\n", WiFi.localIP().toString().c_str());
      Serial.printf("[STATUS] RSSI:           %d dBm\n", WiFi.RSSI());
    }
    Serial.printf("[STATUS] API Endpoint:   %s\n", cfgApiEndpoint.c_str());
    Serial.printf("[STATUS] Supabase Host:  %s\n", cfgSupabaseHost.c_str());
    Serial.println("[STATUS] =========================");
  }
  else if (cmd == "factory-reset") {
    factoryReset();
  }
  else if (cmd.startsWith("phase ")) {
    String modeStr = cmd.substring(6);
    modeStr.trim();
    int mode = modeStr.toInt();
    if (mode == 1 || mode == 3) {
      savePhaseMode(mode);
      Serial.printf("[PROV] Phase mode set to %d-phase. Reboot to apply.\n", mode);
    } else {
      Serial.println("[PROV] Invalid phase mode. Use: phase 1 or phase 3");
    }
  }
  else if (cmd == "help") {
    Serial.println("[SERIAL] Available commands:");
    Serial.println("[SERIAL]   status         - Show current configuration and state");
    Serial.println("[SERIAL]   factory-reset  - Clear all config and enter provisioning mode");
    Serial.println("[SERIAL]   phase 1|3      - Set phase mode (reboot to apply)");
    Serial.println("[SERIAL]   help           - Show this help");
  }
}
