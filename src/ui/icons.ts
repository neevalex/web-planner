// Lucide icons, imported one by one so the bundle only carries what we use.
import {
  createElement, type IconNode,
  Activity, BatteryMedium, Cable, Check, ChevronRight, CircleAlert, Download, FileDiff, FolderOpen,
  Gauge, HardDriveUpload, Info, ListChecks, MessageSquareText, Network, Plug, Power, RefreshCw,
  RotateCcw, Satellite, Search, ShieldAlert, ShieldCheck, SlidersHorizontal, TriangleAlert, Undo2,
  Unplug, Usb, X, Eraser, Zap, SquareTerminal, ChevronUp, ChevronDown, ArrowDownToLine,
  Wrench, Drone, Gamepad2, ToggleRight, Compass, Fan, LifeBuoy, MonitorPlay, Plus,
} from 'lucide';

const ICONS = {
  activity: Activity, battery: BatteryMedium, cable: Cable, check: Check, chevron: ChevronRight,
  alert: CircleAlert, download: Download, diff: FileDiff, folder: FolderOpen, gauge: Gauge,
  write: HardDriveUpload, info: Info, review: ListChecks, messages: MessageSquareText, network: Network,
  plug: Plug, power: Power, refresh: RefreshCw, reread: RotateCcw, satellite: Satellite, search: Search,
  ekfBad: ShieldAlert, ekfOk: ShieldCheck, params: SlidersHorizontal, warn: TriangleAlert, undo: Undo2,
  unplug: Unplug, usb: Usb, close: X, clear: Eraser, armed: Zap,
  terminal: SquareTerminal, up: ChevronUp, down: ChevronDown, toBottom: ArrowDownToLine,
  wrench: Wrench, frame: Drone, radio: Gamepad2, channels: ToggleRight, compass: Compass, motors: Fan,
  failsafe: LifeBuoy, osd: MonitorPlay, plus: Plus,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 18): SVGElement {
  const el = createElement(ICONS[name], { width: size, height: size, 'stroke-width': 2 });
  el.setAttribute('aria-hidden', 'true');
  el.classList.add('icon');
  return el;
}
