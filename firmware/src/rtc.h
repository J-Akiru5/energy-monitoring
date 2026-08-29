#ifndef RTC_H
#define RTC_H

// Initialize the DS3231 RTC.
// Sets rtcAvailable and rtcNeedSync globals.
void setupRTC();

// Get an ISO 8601 timestamp string with timezone offset.
// Falls back to NTP, then to epoch if no time source is available.
String getTimestamp();

#endif
