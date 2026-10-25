# WebPlanner

A web ground control station for ArduPilot, focused on **configuring** vehicles: the full parameter tree with ArduPilot's own documentation, and (next) setup and calibration pages. Copter first, Plane and Rover supported.

Runs in the browser. USB via Web Serial (Chrome/Edge on desktop), UDP/TCP through a small bridge.

## What works now (milestone 1)

- **Connect** over USB (Web Serial, any baud) or the network (UDP listen, UDP to address, TCP) through the bridge.
- **Status bar**: link state, firmware version, flight mode selector, arm/disarm (with confirmation), GPS, battery, EKF health.
- **Parameter editor**
  - Full download with gap filling — completes even on a lossy link (tested at 20% simulated loss).
  - Grouped by prefix (`ATC`, `BATT`, `COMPASS`, `SERVO`…), natural sort (`SERVO2` before `SERVO10`).
  - Search across names, display names and descriptions (`/` focuses search).
  - ArduPilot metadata for Copter, Plane and Rover: description, units, range, increment, enums, bitmasks, reboot-required, read-only.
  - Editors by kind: dropdown for true enums, number input + presets menu for suggested values, checkbox list for bitmasks, ↑/↓ steps by the documented increment.
  - Edits are **staged** (amber) and written together with verification; failures stay staged. Range violations warn before writing.
  - Reboot prompt when a written parameter needs it, then automatic re-read after reboot.
  - Save to `.param`; load a `.param` (Mission Planner, MAVProxy or QGC format) → compare dialog → stage selected differences.
- **Status page**: attitude indicator and bench telemetry. **Messages**: STATUSTEXT log (pre-arm failures etc.).
- Light theme for sunlight, dark theme follows the system. Works on tablets and phones.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

USB: open in Chrome or Edge, **Connect → USB**, pick the port.

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
