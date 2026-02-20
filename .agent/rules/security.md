---
trigger: always_on
---

### 🛡️ IOT-POWER MONOREPO: SECURITY & PERFORMANCE CONSTITUTION (V1.0)

#### 1. SECURITY CORE ("THE BREAKER LOCK")

**Philosophy:** Physical access does not grant digital permission. The ESP32 is treated as an "untrusted client" until it proves its identity via encrypted tokens.

* **The "Owner" Law:**
* The `ADMIN` role is reserved for the Building Manager/Client.
* **Capabilities:** Only the Admin can reset the cumulative `kWh` counters, update electrical rate constants (PHP/kWh), or authorize new ESP32 hardware IDs.
* **Kill Switch:** The Admin can remotely disable a sensor's data ingestion if it shows signs of tampering or hardware failure.


* **Device Authentication (IoT-Auth):**
* Every ESP32 unit has a **Hardcoded Hardware ID (MAC Address)** and a **Secret API Key**.
* **Handshake:** The Next.js API route will reject any POST request that does not include a valid `X-Device-Token` in the header.



#### 2. DATA INTEGRITY & HARDWARE PROTECTION

* **The "Zod" Validator:**
* **Input Sanitation:** All incoming telemetry (Voltage, Current, Watts) must pass through a strict **Zod Schema**.
* **Logic:** `if (voltage > 260) { triggerAlert('Overvoltage') }`. Any data outside physical "Real World" limits (e.g., negative wattage or 10,000V) is discarded and logged as a **Sensor Fault**.


* **Write-Once Logging (The Black Box):**
* The `power_logs` table in PostgreSQL is **Append-Only**.
* No user (including the Admin) can edit historical energy data. This ensures the "Research Integrity" of the power consumption reports.


* **Rate Limiting:**
* The API will throttle any device attempting to send data more than **once per second** to prevent DDoS-style battery drain or server overload.



#### 3. AUTHENTICATION & MIDDLEWARE (NEXT.JS 16)

* **RBAC (Role-Based Access Control):**
* Utilizes **Next.js Middleware** to protect the `/admin` bento dashboard.
* **JWT Protection:** All dashboard sessions are managed via **Supabase Auth** with a 24-hour expiry for security.



```typescript
// Next.js 16 Middleware logic for IoT Security
export async function middleware(req) {
  const token = req.headers.get('x-device-token');
  const isValid = await verifyDeviceToken(token); // Checks against DB
  
  if (!isValid) {
    return new NextResponse('Unauthorized Device', { status: 401 });
  }
}

```

#### 4. PERFORMANCE STANDARDS ("SUB-SECOND SENSING")

* **Edge Data Processing:**
* Calculations for  and  are done on the **ESP32**, not the server. The server only receives the final "Results" to minimize CPU load.


* **Streaming over Polling:**
* The Bento Dashboard utilizes **Server-Sent Events (SSE)**. The frontend does not "ask" for data; the server "pushes" it the moment the ESP32 reports a change.


* **Database Indexing:**
* High-speed indexing on `timestamp` and `device_id` to ensure the **24-hour Consumption Graph** renders in **<150ms**.



---

### 🏛️ Structural Mapping for Security

| Layer | Security Measure | Performance Benefit |
| --- | --- | --- |
| **Hardware** | AES-128 Encryption on Packet | Reduced payload size vs. JSON stringing. |
| **API Route** | Zod Schema Validation | Prevents database "bloat" from junk data. |
| **Database** | TimescaleDB Hypertables | Faster queries for 1,000,000+ power logs. |
| **Frontend** | React Server Components (RSC) | Instant initial load of the Bento Grid. |

