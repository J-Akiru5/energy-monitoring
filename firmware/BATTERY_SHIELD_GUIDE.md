# ⚡ Battery Shield UPS Wiring Guide
**For: Dual 18650 TP4056 Shield → ESP32 Auto-Failover**

---

## How it Works (No Code Required)

The battery shield is a **passive UPS** — it works automatically with zero configuration:

```
Wall Outlet → USB Charger → [Battery Shield] → ESP32
                                   ↑
                           Internal 18650s
                         (charges when power is on,
                          powers ESP32 when power cuts out)
```

When mains power is present, the shield **simultaneously** charges the batteries AND powers the ESP32 through the USB output. When power cuts out, it instantly switches to battery power — there is **no switchover delay** that would reset the ESP32.

---

## What You Need

| Item | Purpose |
|---|---|
| Dual 18650 Battery Shield (yours) | The UPS module |
| 2× 18650 Li-ion cells (already installed) | Power source |
| Micro-USB cable (short, 20–30cm) | Shield USB Out → ESP32 USB In |
| Micro-USB cable (for charging) | Wall charger → Shield USB In |
| 5V / 2A USB wall charger | Must be at least 2A |

> No soldering required. All connections are plug-and-play.

---

## Wiring Diagram

```
┌─────────────────┐           ┌──────────────────────┐
│   5V/2A USB     │  Micro-   │                      │
│  Wall Charger   │──USB──────│  Battery Shield      │
│                 │  (Input)  │  [🔋 Cell 1]         │
└─────────────────┘           │  [🔋 Cell 2]         │
                              │                      │──Micro-USB──→ ESP32
                              │  USB Output Port     │   (Short cable)
└──────────────────────┘
```

**Port identification on your shield:**
- **Left side (small port):** USB INPUT — connect to your wall charger here.
- **Right side (small port):** USB OUTPUT — connect to ESP32 here.
- The LED indicators on the shield show charge status (Red = Charging, Blue/Green = Full).

---

## Step-by-Step Setup

1. **Install the 18650 cells** into the shield holders, observing polarity (+/-) markings.
2. Connect a **Micro-USB cable** from the shield's **USB Output** → ESP32's Micro-USB port.
3. Connect the wall charger to the shield's **USB Input** port.
4. The ESP32 will power on immediately.
5. The shield will charge the batteries in the background.

---

## During a Blackout

| Event | What Happens |
|---|---|
| Power cuts out | Shield switches to battery power **instantly** |
| ESP32 behaviour | Continues running, detects 0V from PZEM, fires `BLACKOUT` alert |
| Wi-Fi router | If router also loses power, ESP32 loses internet — `DEVICE_OFFLINE` alert fires after 2 min |
| Power returns | Shield resumes charging, all systems back to normal |

---

## Battery Life Estimate

| Condition | Estimated Runtime |
|---|---|
| ESP32 alone (Wi-Fi transmitting) | ~4–6 hours |
| ESP32 + passive PZEM read (no AC load) | ~5–7 hours |

> The PZEM-004T itself does not draw significant power from the ESP32 during a blackout (it reads from AC mains). So battery life is primarily determined by the ESP32's Wi-Fi transmissions.

---

## ⚠️ Important Notes

- **Do not use the MB102 breadboard power supply** for the ESP32. Always use the battery shield or a direct USB phone charger (the MB102 cannot handle the Wi-Fi current spikes).
- The PZEM-004T still needs its **AC mains voltage connection** to take real readings. During a blackout it will read 0V / 0A — which is the expected blackout signal.
- Keep the shield away from water and direct sunlight. 18650 cells can be dangerous if overheated or punctured.
