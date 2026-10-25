// Reboot the flight controller, then reload parameters once it's back.
import type { Vehicle } from '../vehicle/vehicle';
import type { Staging } from './staging';
import { confirmDialog } from './dialog';
import { toast } from './toast';

let rebooting = false;

export async function rebootVehicle(vehicle: Vehicle, staging: Staging): Promise<void> {
  if (rebooting) return;
  if (!vehicle.connected) { toast('Not connected', 'warn'); return; }
  if (vehicle.store.state.armed) { toast('Disarm before rebooting', 'warn'); return; }
  const n = staging.pending.size;
  const ok = await confirmDialog('Reboot flight controller?',
    n
      ? `You have ${n} unsaved change${n === 1 ? '' : 's'}. They will be lost when parameters reload — write them first if you want to keep them.`
      : 'The link drops for a few seconds. Parameters reload automatically when the flight controller is back.',
    n ? 'Reboot and discard' : 'Reboot', n > 0);
  if (!ok) return;

  rebooting = true;
  vehicle.log('Rebooting flight controller');
  try { await vehicle.reboot(); } catch { /* many boards reboot before they can acknowledge */ }
  staging.clearReboot();
  toast('Rebooting…', 'info');

  // The vehicle layer notices the restart (uptime resets) and reloads parameters; a USB board that
  // re-enumerates reconnects as a new connection, which reads parameters by itself.
  setTimeout(() => { rebooting = false; }, 10000);
}
