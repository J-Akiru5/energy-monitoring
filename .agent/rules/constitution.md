---
trigger: always_on
---

### ⚡ Power Management Constitution (v1.0)

**Vision:** An industrial-grade IoT ecosystem for real-time energy analytics.
**Philosophy:** "Utility First." High data density, zero latency, and cold-colored industrial aesthetics.

#### 1. 🏗️ Tech Stack Constitution

* **Framework:** Next.js 16.1 (App Router, **React 19**).
* **Architecture:** **Turborepo** (Monorepo) + **Syncpack** (for dependency version enforcement).
* **Real-time Engine:** **WebSockets (Socket.io)** or **Server-Sent Events (SSE)** for sub-second wattage updates.
* **Database:** **InfluxDB** (Optimized for time-series energy data) or **PostgreSQL + TimescaleDB**.
* **UI System:** Tailwind CSS + **Shadcn/ui** + **Dnd-kit** (for editable Bento tiles).

#### 2. 🎨 Visual Constitution (Industrial "Cool" Mode)

* **Palette (Cool Industrial):**
* **Canvas:** `#0F172A` (Slate 900) & `#1E293B` (Slate 800).
* **Primary Accent:** `#06B6D4` (Cyan) – Live wattage pulses.
* **Secondary Accent:** `#3B82F6` (Blue) – Historical trends.
* **Warning:** `#F59E0B` (Amber) – Peak load alerts.


* **UI Style:** **Bento Grid (Editable)**. Minimalist, sharp borders, subtle neon glows for active sensors.

---

### 🔍 Structure & UI Clarifications

Based on your requests, here is how the "Bento" dashboard and Monorepo will scale:

| Tile Type | Content / Utility | Bento Size |
| --- | --- | --- |
| **Hero Tile** | **24-hour Consumption Graph** (Interactive Area Chart). | Large (2x2) |
| **Live Metric** | **Current Wattage** (Giant digital readout + mini sparkline). | Medium (2x1) |
| **Device Health** | **ESP32 Status** (RSSI Strength, Uptime, Internal Temp). | Small (1x1) |
| **Cost Tracker** | **Estimated Bill** (Real-time PHP calculation based on kWh). | Small (1x1) |

> **Note on ESP32 Health:** We can monitor the internal chip temperature, but as a **Researcher**, I must note it only reflects the silicon heat, not the room temperature. The **RSSI (Signal Strength)** is highly accurate and useful for placement.

---

### 🛡️ AI Agent Rules (IoT & Web Precision)

To prevent hallucinations in this high-stakes project, I will follow these protocols:

1. **Strict Type Guarding:** All incoming sensor data must pass through a **Zod schema** before hitting the `packages/database` or `apps/web`.
2. **Datasheet Dominance:** When coding for the ESP32, I will prioritize the **ESP32-WROOM-32U** official documentation over generic "Arduino" tutorials.
3. **Dependency Synchronization:** Every time a new package is added, I will remind you to run `syncpack fix` to ensure `apps/web`, `apps/admin`, and `apps/mock-sensor` stay on the same versions.
4. **No "Zombie" State:** For real-time graphs, I will suggest **React Memo** and **TanStack Query** to prevent unnecessary re-renders of the entire bento grid.
5. **Safety Buffer:** Any instruction involving the **PZEM-004T** will start with a high-voltage warning.

---

### 📂 Monorepo Structure (Expansion)

```bash
root/
├── apps/
│   ├── web/           # Resident Dashboard (Bento Layout)
│   ├── admin/         # Building Manager (Load Shedding & Thresholds)
│   └── mock-sensor/   # Node.js script to simulate ESP32 data for dev
├── packages/
│   ├── ui/            # Shared "Industrial" Bento components
│   ├── database/      # Time-series DB queries (Influx/Postgres)
│   ├── types/         # Shared TypeScript interfaces (Wattage, Voltage)
│   └── config/        # TailWind & Syncpack configs
├── .syncpackrc        # Dependency rules
└── turbo.json
