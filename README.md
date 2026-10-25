# WebPlanner

A web ground control station for ArduPilot, focused on **configuring** vehicles: the full parameter tree with ArduPilot's own documentation, and (next) setup and calibration pages. Copter first, Plane and Rover supported.

Runs in the browser. USB via Web Serial (Chrome/Edge on desktop), UDP/TCP through a small bridge.

## Setup pages

All setup pages edit through the same staged-changes system as the parameter editor: edits turn amber, collect in one tray, and are written and verified together. Each page shows only the parameters this vehicle and firmware actually have, so Copter, Plane (incl. QuadPlane) and Rover get the right fields.

- **Basic** — frame class picker with motor-layout diagram, frame type, board orientation with live attitude, GPS with live fix, battery monitor with live voltage, identity. Accelerometer calibration (6-position, guided) and level calibration.
- **Radio** — live stick gimbals (Mode 1 / Mode 2), every channel's PWM with calibrated min/trim/max, per-channel reverse, radio calibration that stages new `RCn_MIN/MAX/TRIM`, receiver and stick-mapping settings.
- **Channels** — flight-mode channel and the six slots with PWM ranges; the active slot highlights live as you flip the switch; Simple/Super-simple per slot (Copter). Aux functions (`RCn_OPTION`) for every channel through a searchable picker, with live Low/Mid/High switch position.
- **Motors** — motor layout with numbers, spin direction, test letters and output mapping (`SERVOn_FUNCTION`), live motor outputs, motor test per motor or in sequence (click a motor on the diagram), DShot reverse per motor, motor output / battery compensation / ESC settings, and a gallery of common layouts.
- **Compass** — detected compasses decoded from device IDs (bus, address, sensor), priority reordering, use/orientation per compass, onboard calibration with per-compass progress, coverage grid and fitness, plus heading-based quick calibration for large vehicles.
- **Battery** — a tab per monitor in use (plus one to add another), live voltage / current / mAh / remaining with a gauge marking the arm, low and critical thresholds, per-cell readout. Calibration against a multimeter (voltage), a clamp meter (current) or the mAh your charger put back, each computing the new scale factor. Pack presets by chemistry, cell count and capacity (arm/low/critical voltages, optional capacity failsafes, motor thrust compensation, OSD cell count), with your own saved packs. Sensor presets for common analog power modules.
- **Failsafe** — summary of which failsafes are on; radio (with live throttle vs threshold), battery low/critical (with live voltage), ground station, EKF, geofence and others.
- **OSD** — OSD settings and warning thresholds, plus a drag-and-drop screen builder for screens 1–4 (SD PAL/NTSC and HD grids), element list with show/hide, arrow-key nudging.

USB connections are remembered: when the app opens, or when the flight controller is plugged in while it's open, it reconnects to the same port automatically. Disconnecting by hand turns that off until you connect again.

## What works now (milestone 1)

- **Connect** over USB (Web Serial, any baud) or the network (UDP listen, UDP to address, TCP) through the bridge.
- **Status bar** (read-only): link state, firmware version, current mode, armed warning, GPS, battery, EKF health.
- **Parameter editor**
  - Full download with gap filling — completes even on a lossy link (tested at 20% simulated loss).
  - Grouped by subsystem with readable names (Attitude control `ATC`, Battery monitor `BATT`, Compass `COMPASS`…), section headers in the full list, natural sort (`SERVO2` before `SERVO10`).
  - Search across names, display names and descriptions (`/` focuses search).
  - ArduPilot metadata for Copter, Plane and Rover: description, units, range, increment, enums, bitmasks, reboot-required, read-only.
  - Editors by kind: dropdown for true enums, number input + presets menu for suggested values, checkbox list for bitmasks, ↑/↓ steps by the documented increment.
  - Edits are **staged** (amber) and written together with verification; failures stay staged. Range violations warn before writing.
  - Reboot prompt when a written parameter needs it, then automatic re-read after reboot.
  - Save to `.param`; load a `.param` (Mission Planner, MAVProxy or QGC format) → compare dialog → stage selected differences.
- **Status page**: attitude indicator and bench telemetry.
- **Console** docked at the bottom: autopilot messages (pre-arm failures, calibration results) and app events (connect, parameter writes) as timestamped log lines. Collapsible and resizable.
- Light theme for sunlight, dark theme follows the system. Works on tablets and phones.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

USB: open **http://localhost:5173** in Chrome or Edge on the computer the flight controller is plugged into, then **Connect → USB cable**. Chrome only allows Web Serial on secure pages — `https://` or `http://localhost` — so a LAN address like `http://192.168.1.10:5173` won't offer USB. For a LAN device, connect over the network instead, or serve WebPlanner over https.

Network: start the bridge, then **Connect → Network**.

```bash
cd bridge && npm install && cd ..
npm run bridge                       # ws://127.0.0.1:8765, default link udpin:14550
node bridge/bridge.mjs --host 0.0.0.0 --port 8765   # expose on the LAN (e.g. on a Pi)
```

| Link in the app | Use for |
|---|---|
| UDP — listen for the vehicle (14550) | SITL `--out`, Herelink, ELRS/ESP backpacks, mavlink-router |
| UDP — send to address | Companion computers that listen on a fixed port |
| TCP — connect to address | SITL (`127.0.0.1:5760`), ESP8266/ESP32 telemetry bridges |

The bridge relays raw MAVLink; several browser tabs can share one link.

## Deploy (Docker + Cloudflare Tunnel)

```bash
docker compose up -d --build                      # app on :8080
docker compose --profile bridge up -d --build    # also run the bridge on this host (:8765)
```

The app is static (nginx). Point a Cloudflare Tunnel at `http://localhost:8080`. The bridge must be reachable from the browser; only expose it on networks you trust — anyone who can reach it can talk to your vehicle.

Note: Web Serial requires a secure context — `https://` or `http://localhost`.

## Project layout

```
src/mavlink/      generated.ts (from XML) + codec.ts (v1/v2 framing, CRC, parser)
src/transport/    serial.ts (Web Serial), websocket.ts (bridge)
src/vehicle/      vehicle.ts (link, heartbeat, commands), params.ts, paramMeta.ts, modes.ts, state.ts
src/ui/           status bar, connect dialog, params editor, status, messages
bridge/           Node WebSocket ⇄ UDP/TCP relay
tools/            MAVLink and parameter-metadata generators
public/param-meta parameter docs per vehicle (generated)
test/             codec cross-check vs pymavlink, end-to-end test vs SITL
```

## Regenerating

**MAVLink** (after updating `tools/mavlink-xml/` from github.com/ArduPilot/mavlink):

```bash
npm run gen:mavlink
```

**Parameter docs** — generate `apm.pdef.json` from ArduPilot source for each release you want covered, newest stable first:

```bash
cd ardupilot/Tools/autotest/param_metadata
python3 param_parse.py --vehicle ArduCopter --format json   # → apm.pdef.json
node tools/gen-param-meta.mjs copter 4.7.2=Copter-4.7.2.json 4.6.3=Copter-4.6.3.json master=master.json
```

The shipped files merge 4.7.2, 4.6.3 and master, so renamed parameters (e.g. `ARMING_CHECK` → `ARMING_SKIPCHK`, `RTL_ALT` → `RTL_ALT_M`) are documented on both old and new firmware.

## Tests

```bash
npm test                                   # codec vs pymavlink (needs: pip install pymavlink)
npx tsx test/sitl.test.ts tcp --arm        # end-to-end vs SITL through the bridge
npx tsx test/sitl.test.ts udp
npx tsx test/sitl.test.ts tcp --loss 0.2   # 20% simulated packet loss
```

## Next (milestone 2): setup pages

Accelerometer and level calibration, onboard compass calibration with per-compass progress, radio calibration, motor test with frame diagram, GPS, failsafes, frame type, servo outputs.
