// ArduPilot flight modes per vehicle class (custom_mode numbers).
import { MAV_TYPE } from '../mavlink/generated';

export type VehicleClass = 'copter' | 'plane' | 'rover' | 'unknown';

export const COPTER_MODES: Record<number, string> = {
  0: 'Stabilize', 1: 'Acro', 2: 'AltHold', 3: 'Auto', 4: 'Guided', 5: 'Loiter', 6: 'RTL', 7: 'Circle',
  9: 'Land', 11: 'Drift', 13: 'Sport', 14: 'Flip', 15: 'AutoTune', 16: 'PosHold', 17: 'Brake', 18: 'Throw',
  19: 'Avoid_ADSB', 20: 'Guided_NoGPS', 21: 'Smart_RTL', 22: 'FlowHold', 23: 'Follow', 24: 'ZigZag',
  25: 'SystemID', 26: 'AutoRotate', 27: 'Auto_RTL', 28: 'Turtle',
};

export const PLANE_MODES: Record<number, string> = {
  0: 'Manual', 1: 'Circle', 2: 'Stabilize', 3: 'Training', 4: 'Acro', 5: 'FBWA', 6: 'FBWB', 7: 'Cruise',
  8: 'AutoTune', 10: 'Auto', 11: 'RTL', 12: 'Loiter', 13: 'Takeoff', 14: 'Avoid_ADSB', 15: 'Guided',
  17: 'QStabilize', 18: 'QHover', 19: 'QLoiter', 20: 'QLand', 21: 'QRTL', 22: 'QAutoTune', 23: 'QAcro',
  24: 'Thermal', 25: 'Loiter_Alt_QLand', 26: 'AutoLand',
};

export const ROVER_MODES: Record<number, string> = {
  0: 'Manual', 1: 'Acro', 3: 'Steering', 4: 'Hold', 5: 'Loiter', 6: 'Follow', 7: 'Simple', 8: 'Dock',
  9: 'Circle', 10: 'Auto', 11: 'RTL', 12: 'Smart_RTL', 15: 'Guided', 16: 'Initialising',
};

/** Modes offered as one-tap buttons, in order. */
export const QUICK_MODES: Record<VehicleClass, number[]> = {
  copter: [0, 2, 5, 16, 3, 4, 6, 9],
  plane: [0, 2, 5, 6, 10, 12, 11, 15],
  rover: [0, 4, 5, 10, 15, 11],
  unknown: [],
};

const COPTER_TYPES = new Set<number>([
  MAV_TYPE.MAV_TYPE_QUADROTOR, MAV_TYPE.MAV_TYPE_COAXIAL, MAV_TYPE.MAV_TYPE_HELICOPTER,
  MAV_TYPE.MAV_TYPE_HEXAROTOR, MAV_TYPE.MAV_TYPE_OCTOROTOR, MAV_TYPE.MAV_TYPE_TRICOPTER,
  MAV_TYPE.MAV_TYPE_DODECAROTOR, MAV_TYPE.MAV_TYPE_DECAROTOR,
]);
const PLANE_TYPES = new Set<number>([
  MAV_TYPE.MAV_TYPE_FIXED_WING, MAV_TYPE.MAV_TYPE_VTOL_TAILSITTER_DUOROTOR, MAV_TYPE.MAV_TYPE_VTOL_TAILSITTER_QUADROTOR,
  MAV_TYPE.MAV_TYPE_VTOL_TILTROTOR, MAV_TYPE.MAV_TYPE_VTOL_FIXEDROTOR, MAV_TYPE.MAV_TYPE_VTOL_TAILSITTER,
  MAV_TYPE.MAV_TYPE_VTOL_TILTWING, MAV_TYPE.MAV_TYPE_VTOL_RESERVED5,
]);
const ROVER_TYPES = new Set<number>([MAV_TYPE.MAV_TYPE_GROUND_ROVER, MAV_TYPE.MAV_TYPE_SURFACE_BOAT]);

export function vehicleClassOf(mavType: number): VehicleClass {
  if (COPTER_TYPES.has(mavType)) return 'copter';
  if (PLANE_TYPES.has(mavType)) return 'plane';
  if (ROVER_TYPES.has(mavType)) return 'rover';
  return 'unknown';
}

export function modeTable(cls: VehicleClass): Record<number, string> {
  return cls === 'copter' ? COPTER_MODES : cls === 'plane' ? PLANE_MODES : cls === 'rover' ? ROVER_MODES : {};
}

export function modeName(cls: VehicleClass, customMode: number): string {
  return modeTable(cls)[customMode] ?? `Mode ${customMode}`;
}

export function vehicleTypeName(mavType: number): string {
  const entry = Object.entries(MAV_TYPE).find(([, v]) => v === mavType);
  return entry ? entry[0].replace('MAV_TYPE_', '').replace(/_/g, ' ').toLowerCase() : `type ${mavType}`;
}
