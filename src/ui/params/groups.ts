// Human names for ArduPilot parameter prefixes. Anything not listed shows its prefix.

/** Bucket for prefixes that only have one parameter, so the sidebar isn't full of singletons. */
export const GENERAL = '~general';

/** Prefix family of a parameter: BATT2_ and BATTA_ (battery 10) both belong to BATT, EK3_ to EK. */
export function familyOf(name: string): string {
  const head = name.includes('_') ? name.slice(0, name.indexOf('_')) : name;
  const f = head.replace(/\d+$/, '') || head;
  if (/^BATT[A-G]$/.test(f)) return 'BATT';
  if (/^RNGFND[A-Z]$/.test(f)) return 'RNGFND';
  return f;
}

const NAMES: Record<string, string> = {
  ACRO: 'Acro mode', ADSB: 'ADS-B', AHRS: 'Attitude estimation', AIS: 'AIS', ARMING: 'Arming checks',
  AROT: 'Autorotation', ARSPD: 'Airspeed', ATC: 'Attitude control', AUTO: 'Auto mode', AUTOTUNE: 'AutoTune',
  AVD: 'ADS-B avoidance', AVOID: 'Object avoidance', BARO: 'Barometer', BATT: 'Battery monitor',
  BCN: 'Beacons', BRD: 'Board', BTN: 'Buttons', CAM: 'Camera', CAN: 'CAN bus', CHUTE: 'Parachute',
  CIRCLE: 'Circle mode', COMPASS: 'Compass', CRUISE: 'Cruise', CUST: 'Custom rotations', DID: 'Remote ID',
  DISARM: 'Auto disarm', EAHRS: 'External AHRS', EFI: 'Fuel injection', 
  ESC: 'ESC', FENCE: 'Geofence', FFT: 'Gyro FFT', FHLD: 'FlowHold', FLOW: 'Optical flow',
  FLTMODE: 'Flight mode slots', FOLL: 'Follow mode', FORMAT: 'Format', FRAME: 'Frame', FS: 'Failsafes',
  GCS: 'Ground station', GEN: 'Generator', GND: 'Ground station', GPS: 'GPS', GRIP: 'Gripper',
  GUID: 'Guided mode', ICE: 'Combustion engine', INS: 'IMU & sensors', KFF: 'Feed-forward', LAND: 'Landing',
  LGR: 'Landing gear', LOG: 'Logging', LOIT: 'Loiter', MIS: 'Mission', MIXING: 'Mixing', MNT: 'Gimbal mount',
  MODE: 'Modes', MOT: 'Motors', MSP: 'MSP / DisplayPort', NAVL: 'L1 navigation', NET: 'Networking',
  NTF: 'LEDs & buzzer', OA: 'Path planning', OSD: 'On-screen display', PHLD: 'PosHold', PILOT: 'Pilot input',
  PLND: 'Precision landing', PRX: 'Proximity', PSC: 'Position control', PTCH: 'Pitch control',
  Q: 'QuadPlane', RALLY: 'Rally points', RC: 'RC input', RCMAP: 'RC mapping', RELAY: 'Relays',
  RLL: 'Roll control', RNGFND: 'Rangefinder', RPM: 'RPM sensors', RTL: 'Return to launch',
  SAIL: 'Sailboat', SCHED: 'Scheduler', SCR: 'Lua scripting', SERIAL: 'Serial ports',
  SERVO: 'Servo outputs', SID: 'System ID', SPRAY: 'Sprayer', SR: 'Telemetry rates', SRTL: 'Smart RTL',
  STAT: 'Statistics', STEER: 'Steering', STICK: 'Stick mixing', SURFTRAK: 'Surface tracking',
  SYSID: 'System ID', TCAL: 'Temperature cal', TECS: 'TECS', TEMP: 'Temperature sensors',
  TERRAIN: 'Terrain', THR: 'Throttle', THROW: 'Throw mode', TKOFF: 'Takeoff', TRIM: 'Trim',
  TUNE: 'In-flight tuning', VISO: 'Visual odometry', VTX: 'Video transmitter', WINCH: 'Winch',
  WNDVN: 'Wind vane', WP: 'Waypoints', WPNAV: 'Waypoint navigation', YAW: 'Yaw control', ZIGZ: 'ZigZag mode',
  EK: 'EKF navigation filter', MAV: 'MAVLink', SIM: 'Simulation (SITL)', FILT: 'Filters', AFS: 'Advanced failsafe',
  CC: 'Custom controller', RSSI: 'RSSI', DDS: 'ROS 2 / DDS', FRSKY: 'FrSky telemetry', GUIDED: 'Guided mode',
  STEER2SRV: 'Steering control', PTCH2SRV: 'Pitch control', RLL2SRV: 'Roll control', YAW2SRV: 'Yaw control',
  FLAP: 'Flaps', DSPOILER: 'Differential spoilers', NMEA: 'NMEA output', SOAR: 'Soaring', CRASH: 'Crash detection',
  DEV: 'Developer options', FSTRATE: 'Fast-rate loop', GNDEFF: 'Ground effect', PLDP: 'Payload place',
  [GENERAL]: 'General',
};

export const groupName = (family: string) => NAMES[family] ?? family;
