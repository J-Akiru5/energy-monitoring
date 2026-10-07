# ESP32 Flashing Guide — SUPER EASY VERSION

**For students. Follow every step in order. Do not skip any step.**

Time needed: 20–40 minutes the first time. After Part 1 (one-time setup), flashing again takes about 3 minutes.

---

## What are we doing?

We are putting new software (called **firmware**) into the small ESP32 board. We do this with a **USB cable** from your laptop.

The new version is called **4.1.0**. When you finish, the board will say `EMU Firmware v4.1.0` in its messages.

**Important:** You only touch the USB cable. You NEVER open the electrical panel. The wires inside are dangerous (220V). Only a licensed electrician touches those.

---

## What you need (checklist)

- [ ] A Windows laptop
- [ ] A **USB data cable** (a cable that can move data — not a "charge only" cable)
- [ ] The ESP32 box with a USB port
- [ ] Internet connection
- [ ] A GitHub account that can open this page: `https://github.com/J-Akiru5/energy-monitoring` (if you cannot open it, ask your mentor to add you)
- [ ] VS Code installed on your laptop
- [ ] 30–60 minutes of patience

---

# PART 1 — One-time setup (do this only once)

## Step 1 — Install the PlatformIO extension in VS Code

1. Open **VS Code**.
2. On the left side, click the **Extensions** icon (it looks like four squares).
3. In the search box, type: `PlatformIO IDE`
4. Click **Install** on the result named "PlatformIO IDE" (made by PlatformIO).
5. Wait. It may ask to install more things — click **Yes** or **Install** every time.
6. When it is done, a new icon (an alien head) appears on the left side. That is PlatformIO.

## Step 2 — Get the code from GitHub

**Easy way (no git needed):**

1. Open `https://github.com/J-Akiru5/energy-monitoring` in your browser.
2. Click the green **Code** button, then click **Download ZIP**.
3. Find the ZIP file in your Downloads, right-click it, and click **Extract All**.
4. Put the folder somewhere easy, like your **Desktop**.

**If you already know git:**

```
git clone https://github.com/J-Akiru5/energy-monitoring.git
```

## Step 3 — Make the secrets file (a tiny copy-paste)

The firmware needs a file named `secrets.h` to build. It is not on GitHub on purpose.

1. Open the folder `Energy-Monitoring/firmware/src`.
2. Find the file named `secrets.example.h`.
3. Right-click it → **Copy**, then **Paste** in the same folder.
4. Rename the copy to `secrets.h` (delete the `.example` part).
5. Do **NOT** edit anything inside it. The device already has its real settings saved in its own memory.

## Step 4 — Open the correct folder in VS Code

1. In VS Code: **File → Open Folder…**
2. Choose the **firmware** folder. Not the big `Energy-Monitoring` folder. Not `firmware/src`.
   - You are in the right folder if you can see a file named `platformio.ini`.
3. If VS Code asks "Do you trust the authors?", click **Yes, I trust the authors**.
4. Wait for PlatformIO to load (the bottom bar shows progress). The first time it downloads tools — this can take **5–15 minutes**. Let it finish. Do not close VS Code.

---

# PART 2 — Flash the ESP32 (the main event)

## Step 5 — Plug in the USB cable

1. Plug the USB cable into the ESP32 board and into your laptop.
2. Windows may say "Setting up device". Wait.
3. **If later you see no COM port (Step 6), you may need a USB driver.** Ask your mentor for the **CP210x** (Silicon Labs) or **CH340** (WCH) driver installer, install it, then unplug and plug the cable again.

## Step 6 — Check that PlatformIO can see the board

- Click the **PlatformIO icon** (alien head) on the left, then click **Devices**.
  - Or open the terminal in VS Code and type: `pio device list`
- You should see something like `COM5` — that is your board.
- **If you see no COM port:** try a different USB cable, a different USB port on the laptop, or install the driver from Step 5.

## Step 7 — Build (just to be sure it compiles)

- Click the **check mark** (✓) icon in the blue bottom bar (it says "PlatformIO: Build").
  - Or type in the terminal: `pio run`
- Wait. At the end you should see `[SUCCESS]`.
- **If you see an error:** do not continue. Take a screenshot and send it to your mentor.

## Step 8 — Upload (put the firmware on the board)

- Click the **arrow (→)** icon in the blue bottom bar (it says "PlatformIO: Upload").
  - Or type in the terminal: `pio run -t upload`
- Wait. You will see dots and percentages. At the end you should see `[SUCCESS]`.

**If it says `Connecting...` and then `Failed to connect`:**

1. Find the small button labeled **BOOT** on the board.
2. Click Upload again, and while it says `Connecting...`, **hold the BOOT button down**.
3. When you see `Writing at 0x...`, let go of BOOT.

**One more thing:** after the upload, the board restarts by itself. You do NOT need to do anything.

## Step 9 — Look at the board's messages (Serial Monitor)

1. Click the **plug** icon in the blue bottom bar (it says "PlatformIO: Serial Monitor").
2. If it asks for a speed, choose **115200**.
3. You should see this:

```
=====================================
 EMU Firmware v4.1.0 — Production
=====================================
```

4. **If you see `v4.1.0`, the flash worked! Great job.**
5. When you are done looking, **close the Serial Monitor** (click the stop/trash icon). You must close it before uploading again, or the port will be "busy".

---

# PART 3 — Check that everything is OK

You should see these messages in the Serial Monitor:

- [ ] `EMU Firmware v4.1.0 — Production`
- [ ] `[WiFi] Connected!`
- [ ] `[RELAY-POLL] HTTP 200 — state synchronized`
- [ ] New readings every 5 seconds (voltage, current, power)
- [ ] No red error messages repeating over and over

Then tell your mentor: "Flashed and verified v4.1.0". Your mentor can also see `firmware 4.1.0` in the server logs.

---

# If something goes wrong

| What you see | What it means | What to do |
| --- | --- | --- |
| `fatal error: secrets.h: No such file or directory` | You skipped Step 3 | Make the `secrets.h` file (copy of `secrets.example.h`) |
| `Please open a folder containing platformio.ini` | Wrong folder is open | Redo Step 4 and open the **firmware** folder |
| No COM port in Devices | Cable is charge-only, or driver missing | Try another USB data cable / another USB port / install CP210x or CH340 driver |
| `Failed to connect to ESP32` | Board not in flash mode | Hold **BOOT** while it says `Connecting...` (Step 8) |
| `Timed out waiting for packet header` | Same as above | Hold **BOOT** and retry |
| `could not open port COMx: Access is denied` | Serial Monitor is still open | Close the Serial Monitor, then Upload again |
| Upload goes to the wrong thing / weird port list | Multiple devices | Unplug other boards, use `pio device list` to find the right COM port |
| Build takes forever the first time | PlatformIO is downloading tools | Wait. It only happens once. |
| `[WiFi] FAILED to connect` in monitor | Wi-Fi problem | Do NOT panic. Tell your mentor. Do not press any button. |

---

# NEVER DO THIS (important!)

1. **NEVER open the electrical panel.** The sensors touch mains voltage (220V). Only a licensed electrician touches wires. Your job is only the USB cable.
2. **NEVER click "Erase Flash" / "Full Erase"** in PlatformIO. That deletes the device's Wi-Fi name, password, and secret token. Fixing that needs a mentor and a special setup mode.
3. **NEVER press the two buttons on the box.** One erases Wi-Fi settings, the other erases everything.
4. **NEVER flash a random board.** Only the ESP32 given to you in the lab.
5. **NEVER unplug the USB cable in the middle of an upload.** Wait for `[SUCCESS]` first.

---

# When asking your mentor for help, send ALL of this

1. The step number where you got stuck (example: "Step 8").
2. A **screenshot** of the error, including the bottom bar of VS Code.
3. The output of `pio device list` (copy-paste it).
4. Is the little LED on the board on? Yes or no.

---

# Words you will see (mini dictionary)

| Word | Simple meaning |
| --- | --- |
| Firmware | The software inside the ESP32 board |
| Repo | The project folder on GitHub |
| Clone | Copy the GitHub project to your laptop using git |
| PlatformIO | The VS Code tool that builds and uploads firmware |
| Build | Check that the code is correct and make the firmware file |
| Upload / Flash | Send the firmware into the board |
| COM port | The name Windows gives to the USB connection, like `COM5` |
| Serial Monitor | The window that shows messages from the board |
| NVS | The board's own memory. It keeps Wi-Fi and settings even after flashing. |

---

## Super short version (for people who already did Part 1)

```
1. Open the firmware folder in VS Code (the one with platformio.ini)
2. Plug in USB
3. pio run -t upload
4. Open Serial Monitor at 115200
5. See "EMU Firmware v4.1.0" -> done
```

---

*Guide version: 2026-10-08. Firmware version: 4.1.0. If these numbers do not match what your mentor told you, ask before flashing.*
