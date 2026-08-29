#include "rtc.h"
#include "config.h"
#include <RTClib.h>
#include <time.h>

extern RTC_DS3231 rtc;
extern bool rtcAvailable;
extern bool rtcNeedSync;

void setupRTC() {
  if (!rtc.begin()) {
    Serial.println("[RTC] DS3231 not found! Check SDA(21) and SCL(22).");
    Serial.println("[RTC] Will fall back to NTP time only.");
    rtcAvailable = false;
    return;
  }

  rtcAvailable = true;

  if (rtc.lostPower()) {
    Serial.println("[RTC] RTC lost power — will sync from NTP after WiFi connects.");
    rtcNeedSync = true;
  } else {
    DateTime now = rtc.now();
    Serial.printf("[RTC] Clock OK (UTC) -> %04d-%02d-%02dT%02d:%02d:%02dZ\n",
      now.year(), now.month(), now.day(),
      now.hour(), now.minute(), now.second());
  }
}

String getTimestamp() {
  // Prefer RTC — it keeps time even during WiFi outages
  if (rtcAvailable) {
    DateTime utcNow = rtc.now();
    DateTime localNow(utcNow.unixtime() + GMT_OFFSET_SEC);
    char buf[30];
    sprintf(buf, "%04d-%02d-%02dT%02d:%02d:%02d+08:00",
            localNow.year(), localNow.month(), localNow.day(),
            localNow.hour(), localNow.minute(), localNow.second());
    return String(buf);
  }

  // Fall back to NTP time
  struct tm timeinfo;
  if (getLocalTime(&timeinfo)) {
    char buf[30];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", &timeinfo);
    return String(buf) + "+08:00";
  }

  // Last resort — return epoch so the device still uploads (with a bad timestamp)
  Serial.println("[TIME] No time source available — using epoch.");
  return "1970-01-01T00:00:00+08:00";
}
