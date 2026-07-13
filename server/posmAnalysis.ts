// ────────────────────────────────────────────────────────────────────────────
// POSM channel analysis — the "researcher" behind the Analyse POSM button on
// the Trade Offers page. Given a list of point-of-sale materials (hoses,
// playing cards, notebooks, display stands…), decide which trade channel each
// one should be given to, with what priority and suggested kit quantity.
//
// Two paths:
//   1. LLM (gemini via the forge proxy, same as the Forecast Split
//      recommender) — a market-research persona with strict JSON output.
//   2. Rule fallback — keyword table encoding trade-marketing practice
//      (hoses & playing cards → HoReCa top priority, notebooks → all
//      channels, display stands → retail counters, …). Used when the LLM is
//      unavailable or returns something unusable.
// ────────────────────────────────────────────────────────────────────────────
import { invokeLLM } from "./_core/llm";

export const POSM_CHANNELS = ["retail", "wholesale", "semiWholesale", "horeca"] as const;
export type PosmChannel = (typeof POSM_CHANNELS)[number];

// 0 = not suitable, 1 = suitable, 2 = top priority
export type PosmFit = {
  priority: Record<PosmChannel, number>;
  channelQty: Record<PosmChannel, number>;
  rationale: string;
};

const zeroRec = (): Record<PosmChannel, number> => ({ retail: 0, wholesale: 0, semiWholesale: 0, horeca: 0 });

function fit(p: Partial<Record<PosmChannel, number>>, q: Partial<Record<PosmChannel, number>>, rationale: string): PosmFit {
  return { priority: { ...zeroRec(), ...p }, channelQty: { ...zeroRec(), ...q }, rationale };
}

// Keyword rules, first match wins. Ordered from most to least specific.
const KEYWORD_RULES: { re: RegExp; make: () => PosmFit }[] = [
  { re: /hose|pipe|mouth\s?tip|mouthpiece|bowl|head|foil|charcoal|coal|tong|wind\s?cover|heat\s?manag/i,
    make: () => fit({ horeca: 2 }, { horeca: 6 },
      "Smoking hardware is consumed at the lounge table — HoReCa top priority; it upgrades the session and keeps the brand in the guest's hands.") },
  { re: /playing\s?card|backgammon|domino|chess|board\s?game|dice/i,
    make: () => fit({ horeca: 2, retail: 1 }, { horeca: 4, retail: 1 },
      "Table entertainment keeps guests seated longer — HoReCa top priority; a small retail counter giveaway works as a secondary use.") },
  { re: /menu|flavor\s?card|flavour\s?card/i,
    make: () => fit({ horeca: 2 }, { horeca: 2 },
      "Menus only work where flavors are ordered at the table — HoReCa exclusive.") },
  { re: /ashtray|coaster|napkin|tray|cup|mug|glass/i,
    make: () => fit({ horeca: 2, retail: 1 }, { horeca: 6, retail: 2 },
      "Tableware lives on the café table — HoReCa top priority, a couple for retail counters.") },
  { re: /notebook|note\s?book|pen\b|pencil|calendar|diary|agenda/i,
    make: () => fit({ retail: 1, wholesale: 1, semiWholesale: 1, horeca: 1 }, { retail: 2, wholesale: 10, semiWholesale: 4, horeca: 2 },
      "Stationery is a universal goodwill giveaway — all channels; wholesalers get bulk to spread along their routes.") },
  { re: /keychain|key\s?ring|lighter|magnet|sticker pack/i,
    make: () => fit({ retail: 2, semiWholesale: 1, horeca: 1 }, { retail: 5, semiWholesale: 3, horeca: 2 },
      "Small counter giveaways move fastest at retail checkouts — retail top priority.") },
  { re: /display|stand|rack|gondola|counter\s?unit|shelf\s?unit|cabinet/i,
    make: () => fit({ retail: 2, semiWholesale: 1, horeca: 1 }, { retail: 1, semiWholesale: 1, horeca: 1 },
      "Display units win the shelf at the point of purchase — retail top priority, one per tobacconist counter too.") },
  { re: /poster|banner|flag|shelf\s?strip|wobbler|dangler|sticker|sign|light\s?box|neon/i,
    make: () => fit({ retail: 2, semiWholesale: 2, wholesale: 1, horeca: 1 }, { retail: 2, semiWholesale: 2, wholesale: 10, horeca: 1 },
      "Visibility material belongs where shoppers decide — retail and tobacconist walls top priority; wholesalers take bulk to redistribute.") },
  { re: /t-?shirt|polo|cap\b|hat\b|apron|uniform|vest/i,
    make: () => fit({ horeca: 2, wholesale: 1 }, { horeca: 4, wholesale: 5 },
      "Staff apparel turns café crews into walking brand ambassadors — HoReCa top priority; wholesalers can outfit their delivery teams.") },
  { re: /umbrella|parasol|tent|awning|outdoor/i,
    make: () => fit({ horeca: 2 }, { horeca: 2 },
      "Terrace furniture is pure HoReCa — branded shade over every outdoor table.") },
];

export function analyzePosmByRules(name: string): PosmFit {
  const clean = name.trim();
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(clean)) return rule.make();
  }
  return fit(
    { retail: 1, wholesale: 1, semiWholesale: 1, horeca: 1 },
    { retail: 1, wholesale: 1, semiWholesale: 1, horeca: 1 },
    "No clear channel signal in the name — treated as a general giveaway for all channels. Rename it more specifically and re-analyse for a sharper placement.",
  );
}

// ── LLM path ────────────────────────────────────────────────────────────────

const CHANNEL_BRIEF = `Channels:
- retail: shops & kiosks selling packs to consumers; counter/shelf space is the battleground.
- wholesale: master distributors buying in bulk and redistributing to the trade; they value bulk quantities they can spread along routes.
- semiWholesale: semi-wholesalers / tobacconists; counter visibility plus small redistribution.
- horeca: cafés & shisha lounges; the product is consumed at the table, so anything used during a session (hoses, playing cards, menus, tableware, staff apparel) belongs here first.`;

type LlmItemOut = {
  id: number;
  priority: Record<PosmChannel, number>;
  quantity: Record<PosmChannel, number>;
  rationale: string;
};

export async function analyzePosmWithLLM(
  items: { id: number; name: string }[],
): Promise<Map<number, PosmFit>> {
  const channelProps = Object.fromEntries(POSM_CHANNELS.map(c => [c, { type: "integer", minimum: 0 }]));
  const resp = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are a senior trade-marketing researcher for a global shisha (hookah tobacco) brand. You decide which sales channel each point-of-sale material (POSM) should be given to. ${CHANNEL_BRIEF}

For each item return:
- priority per channel: 0 = not suitable, 1 = suitable, 2 = top priority. At least one channel must be non-zero; give 2 to at most two channels.
- quantity per channel: suggested number of units in that channel's kit for ONE account visit (0 when priority is 0, small realistic numbers otherwise; wholesalers may get bulk, e.g. 10).
- rationale: ONE plain-English sentence a market manager can read aloud — why this item lands in those channels. No jargon.`,
      },
      {
        role: "user",
        content: `Assign these POSM items:\n${items.map(i => `- id ${i.id}: ${i.name}`).join("\n")}`,
      },
    ],
    outputSchema: {
      name: "posm_analysis",
      schema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "integer" },
                priority: { type: "object", properties: channelProps, required: [...POSM_CHANNELS], additionalProperties: false },
                quantity: { type: "object", properties: channelProps, required: [...POSM_CHANNELS], additionalProperties: false },
                rationale: { type: "string" },
              },
              required: ["id", "priority", "quantity", "rationale"],
              additionalProperties: false,
            },
          },
        },
        required: ["items"],
        additionalProperties: false,
      },
    },
  });

  const raw = (resp as any)?.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((p: any) => p?.text ?? "").join("") : "";
  const parsed = JSON.parse(text) as { items: LlmItemOut[] };
  if (!parsed || !Array.isArray(parsed.items)) throw new Error("LLM returned no items array");

  const out = new Map<number, PosmFit>();
  for (const it of parsed.items) {
    if (typeof it?.id !== "number") continue;
    const priority = zeroRec();
    const channelQty = zeroRec();
    let any = false;
    for (const ch of POSM_CHANNELS) {
      const p = Math.max(0, Math.min(2, Math.round(Number(it.priority?.[ch]) || 0)));
      const q = Math.max(0, Math.round(Number(it.quantity?.[ch]) || 0));
      priority[ch] = p;
      channelQty[ch] = p > 0 ? Math.max(q, 1) : 0;
      if (p > 0) any = true;
    }
    if (!any) continue; // unusable row — fallback will cover it
    out.set(it.id, { priority, channelQty, rationale: String(it.rationale || "").slice(0, 500) });
  }
  return out;
}

// Full analysis: LLM first, per-item rule fallback for anything the LLM
// missed, whole-list rule fallback when the LLM is unavailable/broken.
export async function analyzePosmItems(
  items: { id: number; name: string }[],
): Promise<{ fits: Map<number, PosmFit & { source: "ai" | "rules" }>; usedLLM: boolean }> {
  const fits = new Map<number, PosmFit & { source: "ai" | "rules" }>();
  let usedLLM = false;
  if (items.length === 0) return { fits, usedLLM };
  try {
    const llm = await analyzePosmWithLLM(items);
    for (const [id, f] of llm) fits.set(id, { ...f, source: "ai" });
    usedLLM = llm.size > 0;
  } catch (e: any) {
    console.warn(`[POSM] LLM analysis unavailable, using rules: ${e?.message || e}`);
  }
  for (const item of items) {
    if (!fits.has(item.id)) fits.set(item.id, { ...analyzePosmByRules(item.name), source: "rules" });
  }
  return { fits, usedLLM };
}
