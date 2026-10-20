import type { Capsule } from "@/lib/data";

// Unified icon control: size, corner radius, subtle border.
const ICON_SIZE = 22;
const ICON_RADIUS = 6;

// agent/tool identifier or display name -> icon file in /public/icons
const ICON_MAP: Record<string, string> = {
  trae: "trae.png",
  cursor: "cursor.png",
  claude: "claude.png",
  "claude code": "claude.png",
  codex: "codex.png",
  gemini: "gemini.png",
  openai: "openai.webp",
  cindy: "cindy.png",
  workbuddy: "codebuddy.webp",
  codebuddy: "codebuddy.webp",
  windsurf: "windsurf.png",
  vscode: "vscode.png",
  "vscode-copilot": "vscode.png",
  qoder: "qoder.png",
  imported: "generic.png",
  unknown: "generic.png",
};

function resolveIcon(id: string, name: string): string {
  const key = id.toLowerCase();
  // Exact match on id
  if (ICON_MAP[key]) return ICON_MAP[key];
  const nKey = name.toLowerCase();
  // Exact match on name
  if (ICON_MAP[nKey]) return ICON_MAP[nKey];
  // Partial name fallback — prefer longer keys first to avoid "code" matching
  // before "codebuddy" (e.g. "CodeBuddy" → "codebuddy", not "codex")
  const sortedKeys = Object.keys(ICON_MAP).sort((a, b) => b.length - a.length);
  for (const k of sortedKeys) {
    if (nKey.includes(k)) return ICON_MAP[k];
  }
  return "generic.png";
}

// Placeholder tools that don't map to a real product/agent — their icon is a
// generic fallback and shouldn't be shown as a "tool" in the chat log header.
const GENERIC_IDS = new Set(["generic", "unknown", "imported", ""]);

export default function ToolIcons({ tools }: { tools?: Capsule["tools"] }) {
  if (!tools || tools.length === 0) return null;
  const seen = new Set<string>();
  const items = tools.filter((t) => {
    if (!t.id || seen.has(t.id)) return false;
    seen.add(t.id);
    // Skip the placeholder "generic" tool icon (no real tool behind it).
    if (GENERIC_IDS.has(t.id.toLowerCase()) || GENERIC_IDS.has((t.name || "").toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="flex items-center gap-1.5">
      {items.map((t) => {
        const file = resolveIcon(t.id, t.name);
        return (
          <span
            key={t.id}
            title={t.name}
            className="inline-flex items-center justify-center overflow-hidden"
            style={{
              width: ICON_SIZE,
              height: ICON_SIZE,
              borderRadius: ICON_RADIUS,
              border: "1px solid rgba(255,255,255,0.25)",
              flexShrink: 0,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/icons/${file}`}
              alt={t.name}
              width={ICON_SIZE}
              height={ICON_SIZE}
              className="block object-cover"
              style={{ width: ICON_SIZE, height: ICON_SIZE }}
            />
          </span>
        );
      })}
    </div>
  );
}
