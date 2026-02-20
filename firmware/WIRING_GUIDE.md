# 🔌 Wiring Guide — ESP32 + PZEM-004T v3.0 (Single Phase)

> ⚡ **HIGH-VOLTAGE WARNING** ⚡  
> The PZEM-004T v3.0 is connected to **mains AC power (220V)**.  
> All physical installation **MUST be performed by a licensed electrician**.  
> **Never** work on live wires. De-energize the breaker before wiring.

---

## 📋 Components Required

| Component | Qty | Notes |
|-----------|-----|-------|
| ESP32-WROOM-32U (or 32D) | 1 | Dev board with USB-C preferred |
| PZEM-004T v3.0 | 1 | Includes CT clamp (100A max) |
| CT Clamp (split-core) | 1 | Included with PZEM-004T |
| Jumper wires (Male-Female) | 4 | For UART + power connections |
| 5V USB Power Supply | 1 | For ESP32 (micro-USB or USB-C) |
| Enclosure (optional) | 1 | IP-rated box for safety |

---

## 🔗 Wiring Diagram

### Data Connection (UART)

```
ESP32                    PZEM-004T v3.0
┌──────────┐             ┌──────────────┐
│          │             │              │
│  GPIO16 ──────────────── TX           │
│  (RX2)   │             │              │
│          │             │              │
│  GPIO17 ──────────────── RX           │
│  (TX2)   │             │              │
│          │             │              │
│  5V     ──────────────── VCC (5V)     │
│          │             │              │
│  GND    ──────────────── GND          │
│          │             │              │
└──────────┘             └──────────────┘
```

### AC Power Connection (Mains Side)

```
Breaker Panel
┌────────────────────┐
│                    │
│  LIVE (L) ─────────┼──┐
│                    │  │   ┌─────────────────────┐
│  NEUTRAL (N) ──────┼──┼──── N (Neutral In)     │
│                    │  │   │                     │
│                    │  └──── L (Live In)         │
│                    │      │                     │
└────────────────────┘      │  PZEM-004T v3.0     │
                            │                     │
                            │  CT Clamp ◉──────── │
                            │  (clips around      │
                            │   the LIVE wire)     │
                            └─────────────────────┘

⚠ The CT clamp clips AROUND the Live wire — it does NOT cut into it.
   The clamp measures current magnetically (non-invasive on the wire).

⚠ The AC terminals (L/N) on the PZEM are connected IN PARALLEL
   to measure voltage. They are NOT in series with the load.
```

---

## 🔌 Step-by-Step Installation

### Pre-Installation Safety Checklist
- [ ] Turn OFF the main breaker before any wiring
- [ ] Verify power is off with a voltage tester
- [ ] Wear insulated gloves
- [ ] Work with a licensed electrician

### Step 1: Wire the PZEM-004T to the Breaker Panel
1. Connect the **Live (L)** terminal of the PZEM-004T to the breaker's Live output.
2. Connect the **Neutral (N)** terminal of the PZEM-004T to the Neutral bus.
3. Clip the **CT Clamp** around the **Live wire** (the one going to your load/building).
   - The arrow on the CT clamp should point **toward the load** (away from breaker).

### Step 2: Wire the ESP32 to the PZEM-004T
1. Connect `ESP32 GPIO16 (RX2)` → `PZEM TX`
2. Connect `ESP32 GPIO17 (TX2)` → `PZEM RX`
3. Connect `ESP32 5V` → `PZEM VCC`
4. Connect `ESP32 GND` → `PZEM GND`

### Step 3: Power the ESP32
1. Connect the ESP32 to a **5V USB power supply** (phone charger works).
2. Place the ESP32 **outside** the breaker panel — away from high-voltage wires.

### Step 4: Verify
1. Open the **Arduino Serial Monitor** at `115200 baud`.
2. You should see readings every 2 seconds:
   ```
   ─── PZEM Reading ───
     Voltage:      220.5 V
     Current:      15.234 A
     Power:        3350.1 W
     Energy:       1.2340 kWh
     Frequency:    60.0 Hz
     Power Factor: 0.99
   ────────────────────
   ```

---

## ⚠ Troubleshooting

| Issue | Solution |
|-------|---------|
| `NaN` readings | Check UART wiring (TX↔RX swapped?) |
| `0.00 V` voltage | Check AC L/N connections to PZEM |
| `0.000 A` current | Ensure CT clamp is fully closed around the wire |
| WiFi won't connect | Check SSID/password in `main.ino` |
| API returns 401 | Verify `DEVICE_TOKEN` matches the Admin dashboard |

---

## 📐 Pin Reference (ESP32-WROOM-32U)

| ESP32 Pin | Function | Connected To |
|-----------|----------|-------------|
| GPIO16 | UART2 RX | PZEM TX |
| GPIO17 | UART2 TX | PZEM RX |
| 5V (VIN) | Power | PZEM VCC |
| GND | Ground | PZEM GND |

> **Note**: GPIO16 and GPIO17 are the default pins for `Serial2` on most ESP32 dev boards.
> If your board uses different pins, update the `PZEM004Tv30 pzem(Serial2, RX, TX)` line in `main.ino`.
