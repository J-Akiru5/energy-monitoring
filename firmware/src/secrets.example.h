#ifndef SECRETS_H
#define SECRETS_H

// Wi-Fi Credentials
const char* WIFI_SSID     = "your-wifi-ssid";
const char* WIFI_PASSWORD = "your-wifi-password";

// Cloud API Endpoint (Vercel deployment)
const char* API_ENDPOINT  = "https://your-deployment.vercel.app/api/ingest";

// Device Authentication Token (matches DEVICE_API_KEY in .env / Admin dashboard)
const char* DEVICE_TOKEN  = "your-device-secret-token";

// Device ID (UUID from Supabase devices table)
const char* DEVICE_ID     = "your-device-uuid";

// Supabase Realtime credentials
const char* SUPABASE_HOST     = "your-project.supabase.co";
const char* SUPABASE_ANON_KEY = "your-anon-key-here";

#endif
