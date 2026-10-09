// Avatars: a piece the player picks (piece icons, as the design says; no uploads yet), shown as a
// round badge. Stored in profiles.avatar as "<colour>-<piece>", e.g. "red-horse".
export const AVATAR_PIECES = [
  { id: "general", red: "帅", black: "将" },
  { id: "advisor", red: "仕", black: "士" },
  { id: "elephant", red: "相", black: "象" },
  { id: "horse", red: "马", black: "马" },
  { id: "chariot", red: "车", black: "车" },
  { id: "cannon", red: "炮", black: "炮" },
  { id: "soldier", red: "兵", black: "卒" },
] as const;

export const AVATARS: string[] = AVATAR_PIECES.flatMap((p) => [`red-${p.id}`, `black-${p.id}`]);

/** The character and colour to draw for an avatar id, or null when it isn't one. */
export function avatarFace(avatar: string | null): { char: string; color: "red" | "black" } | null {
  const [color, id] = (avatar ?? "").split("-") as ["red" | "black", string];
  const piece = AVATAR_PIECES.find((p) => p.id === id);
  if (!piece || (color !== "red" && color !== "black")) return null;
  return { char: piece[color], color };
}

/** A country's flag, from its two-letter code (regional indicator letters). */
export const flagOf = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));

/** ISO 3166-1 alpha-2 codes, named in the page's language by Intl.DisplayNames. */
export const COUNTRIES =
  "AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW".split(" ");
