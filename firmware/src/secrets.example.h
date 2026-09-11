#ifndef SECRETS_H
#define SECRETS_H

// ════════════════════════════════════════════════════════════
// SECRETS.H — Compile-time defaults for EMU firmware
// ════════════════════════════════════════════════════════════
//
// These values are compile-time defaults. At runtime, NVS
// values (set during provisioning) override them.
//
// For production deployment:
//   1. Copy this file to secrets.h
//   2. Fill in the values below for your environment
//   3. The ESP32 provisioning flow will store real values in NVS
//
// DO NOT commit secrets.h with real credentials to Git.
// ════════════════════════════════════════════════════════════

#ifndef API_ENDPOINT_DEFAULT
#define API_ENDPOINT_DEFAULT "https://your-deployment.vercel.app/api/ingest"
#endif

#ifndef SUPABASE_HOST_DEFAULT
#define SUPABASE_HOST_DEFAULT "your-project.supabase.co"
#endif

#ifndef SUPABASE_KEY_DEFAULT
#define SUPABASE_KEY_DEFAULT "your-anon-key-here"
#endif

#endif
