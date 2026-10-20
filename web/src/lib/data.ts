export const navLinks = [
  { label: "Gamme", href: "#gamme" },
  { label: "Bénéfices", href: "#benefits-1" },
  { label: "FAQ", href: "#FAQ" },
  { label: "Newsletter", href: "#newsletter" },
];

export interface Capsule {
  id: string;
  name: string;
  nameEn: string;
  dates: string;
  primary: string;
  secondary: string;
  summary: string;
  description: string;
  mood: string;
  place: string;
  stats: {
    dialogCount: string;
    activeDay: string;
    duration: string;
    dataStatus: string;
  };
  modelPrefs?: { label: string; value: number }[];
  /** local output folder name under projects/ — used by the "打开文件夹" button (chat records) */
  folder?: string;
  /** project completion time (timeRange.end) as epoch ms — used to sort the search list by completion time */
  completedAtMs?: number;
  /** absolute path to the project's produced output folder — preferred by "打开文件夹" */
  projectPath?: string;
  /** AI tools / agents used in this project (id maps to /icons/<id>.webp) */
  tools?: { id: string; name: string }[];
  workLog: {
    title: string;
    duration: string;
    items: { num: string; title: string; desc: string; bullets?: string[] }[];
  };
  chat?: ChatMsg[];
  heatmap?: Record<string, number>;
}

export interface ChatMsg {
  role: "me" | "you" | "system";
  text: string;
  time?: string;
  model?: string;
}

// Real projects are loaded live from the Electron backend (disk) at runtime.
// No build-time baked demo capsules are shipped — the library stays empty
// until the desktop shell provides real project data.
export const capsules: Capsule[] = [];

// backwards-compat alias used by scenes
export const flavors = capsules;

// --- name-based deterministic colors (fallback only; real data carries its own colors) ---
function hslToHex(h: number, sat: number, light: number): string {
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = light - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function nameColors(name: string): { primary: string; secondary: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return {
    primary: hslToHex(hue, 0.62, 0.4),
    secondary: hslToHex(hue, 0.88, 0.66),
  };
}

// --- carousel slots: only use placeholder empty cans when there is no real data ---
export type Slot = Capsule | null;

export function computeSlots(): Slot[] {
  if (capsules.length === 0) return [null];
  return [...capsules];
}

export const slots: Slot[] = computeSlots();
