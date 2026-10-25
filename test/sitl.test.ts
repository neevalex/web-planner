// End-to-end test against ArduPilot SITL through the bridge, using the app's real Vehicle code.
//   1) run SITL (TCP 5760, and --serial1 udpclient:127.0.0.1:14550 for the UDP test)
//   2) node bridge/bridge.mjs
//   3) npx tsx test/sitl.test.ts [tcp|udp] [--arm]
import { Vehicle, resultName } from '../src/vehicle/vehicle';
import { WebSocketTransport, type NetTarget } from '../src/transport/websocket';
import { formatValue } from '../src/vehicle/params';
import { parseParamFile, writeParamFile } from '../src/ui/params/paramFile';

const mode = process.argv[2] ?? 'tcp';
const doArm = process.argv.includes('--arm');
const target: NetTarget = mode === 'udp' ? { kind: 'udp-listen', port: 14550 } : { kind: 'tcp', host: '127.0.0.1', port: 5760 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = performance.now();
const log = (...a: unknown[]) => console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s]`, ...a);
let failures = 0;
const check = (ok: boolean, what: string) => { console.log(ok ? '  PASS' : '  FAIL', what); if (!ok) failures++; };

async function until(cond: () => boolean, ms: number, what: string) {
  const start = performance.now();
  while (!cond()) {
    if (performance.now() - start > ms) throw new Error(`timeout: ${what}`);
    await sleep(50);
  }
}

// --loss 0.2 drops that fraction of incoming chunks, to exercise gap filling on a bad link.
const lossArg = process.argv.indexOf('--loss');
const loss = lossArg > 0 ? Number(process.argv[lossArg + 1]) : 0;
class LossyTransport extends WebSocketTransport {
  protected emitData(d: Uint8Array) { if (Math.random() >= loss) super.emitData(d); }
}

const v = new Vehicle();
await v.connect(new LossyTransport('ws://127.0.0.1:8765', target));
if (loss) log(`simulating ${loss * 100}% incoming loss`);
log(`connected via ${v.store.state.linkLabel}`);

await until(() => v.store.state.link === 'connected', 15000, 'heartbeat');
const s = v.store.state;
log(`heartbeat: sysid ${s.sysid}, class ${s.vehicleClass}, mode ${s.modeName}`);
check(s.vehicleClass === 'copter', 'vehicle detected as copter');

await until(() => v.params.progress.done, 60000, 'param download');
const p = v.params.progress;
log(`params: ${p.received}/${p.total} ${p.error ?? ''}`);
check(p.total > 500 && p.received === p.total && !p.error, 'all parameters downloaded');
check(v.params.params.size === p.total, 'param map size matches count');

await until(() => !!v.store.state.firmware, 5000, 'AUTOPILOT_VERSION').catch(() => {});
log(`firmware: ${v.store.state.firmware}`);
check(/ArduCopter V\d/.test(v.store.state.firmware), 'firmware version decoded');

// Verified write of a float and an int param, then restore.
const orig = v.params.get('ATC_RAT_RLL_P')!.value;
const wrote = await v.params.set('ATC_RAT_RLL_P', 0.142);
check(formatValue(wrote) === '0.142', `float write verified (got ${formatValue(wrote)})`);
const reread = await v.params.refresh('ATC_RAT_RLL_P');
check(formatValue(reread.param_value) === '0.142', 'value persisted on re-read');
await v.params.set('ATC_RAT_RLL_P', orig);

const origFs = v.params.get('FS_THR_VALUE')!.value;
const origAng = v.params.get('ATC_ANG_PIT_P')!.value;
const failed = await v.params.setMany([['FS_THR_VALUE', 955], ['ATC_ANG_PIT_P', 5.5]]);
check(failed.length === 0, 'setMany wrote int + float params');
check(v.params.get('FS_THR_VALUE')!.value === 955, 'FS_THR_VALUE updated in local store');
await v.params.setMany([['FS_THR_VALUE', origFs], ['ATC_ANG_PIT_P', origAng]]);

// Rejected / unknown param
try { await v.params.set('NOT_A_PARAM', 1, 1); check(false, 'unknown param rejected'); }
catch (e) { check(true, `unknown param rejected (${(e as Error).message})`); }

// .param round trip
const text = writeParamFile([...v.params.params.values()].map((x) => [x.name, formatValue(x.value, x.type)]), ['test']);
const parsed = parseParamFile(text);
const mismatch = [...parsed.values].filter(([n, val]) => Math.fround(val) !== Math.fround(v.params.get(n)!.value));
check(parsed.values.size === v.params.params.size && mismatch.length === 0, `.param round trip (${parsed.values.size} params, ${mismatch.length} mismatches)`);

// Mode change
const r = await v.setMode(5); // Loiter
await until(() => v.store.state.customMode === 5, 3000, 'mode change').catch(() => {});
check(r === 0 && v.store.state.modeName === 'Loiter', `mode change to Loiter (${resultName(r)}, now ${v.store.state.modeName})`);
await v.setMode(0);

// Telemetry flowing
await sleep(1500);
const st = v.store.state;
log(`telemetry: lat ${st.lat}, lon ${st.lon}, alt ${st.altRel.toFixed(1)}, gps fix ${st.gpsFix} sats ${st.gpsSats}, batt ${st.batteryVoltage}V, rx ${(st.rxRate / 1024).toFixed(1)} kB/s`);
check(st.lat !== null && Math.abs(st.lat - 50.4501) < 0.01, 'position matches SITL home');
check(st.batteryVoltage > 10, 'battery voltage reported');
check(loss > 0 || st.messages.length > 0, `status texts received (${st.messages.length}, last: "${st.messages.at(-1)?.text}")`);

if (doArm) {
  log('waiting for EKF/GPS to arm…');
  await until(() => v.store.state.ekfOk === true && v.store.state.gpsFix >= 3, 90000, 'EKF ready').catch(() => {});
  await v.setMode(4);
  let ar = -1;
  for (let i = 0; i < 20 && ar !== 0; i++) { ar = await v.arm(true); if (ar !== 0) await sleep(2000); }
  await until(() => v.store.state.armed, 3000, 'armed').catch(() => {});
  check(v.store.state.armed, `armed (${resultName(ar)})`);
  await v.arm(false, true);
  await until(() => !v.store.state.armed, 3000, 'disarmed').catch(() => {});
  check(!v.store.state.armed, 'disarmed');
}

await v.disconnect();
log(failures ? `${failures} FAILURES` : 'ALL PASS');
process.exit(failures ? 1 : 0);
