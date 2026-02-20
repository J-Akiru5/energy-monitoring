---
trigger: always_on
---

### 🏛️ INDUSTRIAL POWER CONSTITUTION (v1.0)

**Vision:** A high-precision, utilitarian ecosystem for industrial energy monitoring.

**Philosophy:** "Data as First-Class Citizen." High density, zero-latency feedback, and "Cold Industrial" aesthetics.

#### 1. 🏗️ Tech Stack Constitution

* **Framework:** **Next.js 16.1** (LTS) utilizing stable **Turbopack** and **React 19.2**.
* **Architecture:** **Turborepo** Monorepo with **Syncpack** for dependency enforcement.
* **Styling:** **Tailwind CSS 4.0** + **Shadcn/ui** (utilizing the "Stone" and "Cyan" base).
* **Dashboard Engine:** **dnd-kit** for editable Bento grid persistence.

#### 2. 🎨 Visual Constitution (Industrial "Cool" Light Mode)

* **Palette:**
* **Canvas:** `#FFFFFF` (Main Background) / `#F8FAFC` (Bento Gutter).
* **Surface:** `#F1F5F9` (Card Backgrounds) with `border-slate-200`.
* **Primary Accent:** `#0891B2` (**Cyan-600**) – Pinned to "Live" state pulses.
* **Secondary:** `#1E293B` (**Slate-800**) – Professional headers and labels.
* **Alert:** `#E11D48` (**Rose-600**) – Overload/Fault states.


* **Typography:**
* **Headlines/UI:** **Inter** (Semi-bold, -0.02em tracking).
* **Data/Metrices:** **JetBrains Mono** (Medium) – Essential for all numeric readouts.



#### 3. 🗺️ Navigation & Positioning Protocol

The system follows a "Modular Command" layout across all three apps to maintain muscle memory for the user.

| App | Navbar Position | Primary Navigation Style |
| --- | --- | --- |
| **`apps/web`** | **Top-Fixed (Glass)** | Horizontal menu with live "System Health" dot in the far right. |
| **`apps/admin`** | **Left-Sidebar (Solid)** | Collapsible sidebar (`w-64`) with grouping (Sensors, Users, Billing). |
| **`apps/mock`** | **Floating Control** | A minimized overlay "Command Palette" to inject data into the system. |

* **Bento Law:** All dashboards must use a **12-column grid**.
* *Default Hero (24h Graph):* `col-span-8 row-span-2`.
* *Metric Tiles:* `col-span-4 row-span-1`.
* *System Status:* `col-span-4 row-span-1`.


#### 5. 🖱️ Component Constitution

* **The "Power" Card:** 1px solid border, `shadow-sm`, no rounded corners (or `rounded-sm` max). Must include a `Grip` icon in the top-right for the "Editable" mode.
* **The "Live" Metric:** Large `text-4xl` JetBrains Mono font. If the value changes, the text should briefly flash **Cyan-500** before settling back to Slate-800.
* **Interactive Inputs:** Utilitarian style. `bg-slate-50` with a `focus:border-cyan-500` bottom-border only.

