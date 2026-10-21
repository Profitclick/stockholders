/**
 * Custody / broker platform catalog for the Norwegian shareholder register (Aksjonærregisteret).
 *
 * Shares held through a nominee account (forvalterkonto) in VPS / Euronext Securities Oslo are
 * registered under the nominee's name — e.g. "NORDNET BANK AB" — not under the underlying owner.
 * This catalog maps those registered shareholder names to the platform (bank, broker, custodian)
 * that operates the account. It is the single source of truth: the ETL that loads platform
 * exposure imports `classifyShareholder` from here, and the UI reads labels from here.
 *
 * Rules are evaluated top to bottom and the first match wins, so more specific business lines
 * (e.g. "CITIBANK (SWITZERLAND)") must come before broader ones (e.g. "CITIBANK").
 */

export type PlatformCategory =
  | "retail"
  | "nordic_bank"
  | "nordic_broker"
  | "private_bank"
  | "global_custody"
  | "investment_bank"
  | "european_bank"
  | "infrastructure"
  | "fund";

export interface CategoryInfo {
  id: PlatformCategory;
  label: string;
  short: string;
  investorProfile: string;
  description: string;
  /** True when holdings are nominee accounts (underlying owners hidden). Funds own in their own name. */
  isNominee: boolean;
  order: number;
}

export const PLATFORM_CATEGORIES: Record<PlatformCategory, CategoryInfo> = {
  retail: {
    id: "retail",
    label: "Nettmegler / privatplattform",
    short: "Retail",
    investorProfile: "Selvbetjente privatinvestorer (aksjesparekonto, IPS, aksjekonto)",
    description: "Nettbaserte handelsplattformer der privatpersoner handler selv. Høy andel betyr bred retail-eierbase.",
    isNominee: true,
    order: 1,
  },
  nordic_bank: {
    id: "nordic_bank",
    label: "Nordisk bank",
    short: "Nordisk bank",
    investorProfile: "Bankkunder, private banking og fond via nordiske storbanker",
    description:
      "Forvalterkontoer i nordiske banker. Kan også inneholde bankens egen beholdning — skillet er ikke offentlig.",
    isNominee: true,
    order: 2,
  },
  nordic_broker: {
    id: "nordic_broker",
    label: "Nordisk meglerhus",
    short: "Meglerhus",
    investorProfile: "Aktive investorer, formuende privatpersoner og institusjoner via meglerhus",
    description: "Meglerhus og investeringsbanker i Norden som tilbyr forvaltertjenester til sine kunder.",
    isNominee: true,
    order: 3,
  },
  private_bank: {
    id: "private_bank",
    label: "Privatbank / formuesforvaltning",
    short: "Privatbank",
    investorProfile: "Formuende privatpersoner (HNWI) og familiekontorer",
    description: "Sveitsiske, luxembourgske og andre private banker. Signal om formuende eiere bak forvalterkontoen.",
    isNominee: true,
    order: 4,
  },
  global_custody: {
    id: "global_custody",
    label: "Global depotbank",
    short: "Depotbank",
    investorProfile: "Utenlandske fond, pensjonskasser og kapitalforvaltere",
    description: "Globale depotbanker som oppbevarer aksjer for internasjonale institusjoner og fond.",
    isNominee: true,
    order: 5,
  },
  investment_bank: {
    id: "investment_bank",
    label: "Investeringsbank / prime broker",
    short: "Inv.bank",
    investorProfile: "Hedgefond, trading, aksjelån og prime brokerage",
    description: "Kontoer hos globale investeringsbanker — ofte aktive fond, aksjelån og kortsiktig handel.",
    isNominee: true,
    order: 6,
  },
  european_bank: {
    id: "european_bank",
    label: "Europeisk bank",
    short: "EU-bank",
    investorProfile: "Kunder av europeiske universalbanker",
    description: "Kontinentaleuropeiske banker som holder aksjer for sine kunder.",
    isNominee: true,
    order: 7,
  },
  infrastructure: {
    id: "infrastructure",
    label: "Oppgjør / sentral motpart",
    short: "Oppgjør",
    investorProfile: "Internasjonal oppgjørsinfrastruktur — underliggende eiere er ukjente",
    description: "Verdipapirsentraler og sentrale motparter (Clearstream, Euroclear, SIX, LCH).",
    isNominee: true,
    order: 8,
  },
  fund: {
    id: "fund",
    label: "Norske aksjefond",
    short: "Fond",
    investorProfile: "Sparekapital og institusjoner via norske verdipapirfond",
    description: "Verdipapirfond eier i eget navn (ikke forvalterkonto). Viser hvilke forvaltere som er inne.",
    isNominee: false,
    order: 9,
  },
};

export const CATEGORY_ORDER: PlatformCategory[] = (Object.values(PLATFORM_CATEGORIES) as CategoryInfo[])
  .sort((a, b) => a.order - b.order)
  .map((c) => c.id);

/** Categories counted as foreign institutional capital in flow metrics. */
export const FOREIGN_INSTITUTIONAL_CATEGORIES: PlatformCategory[] = ["global_custody", "investment_bank", "infrastructure"];

export interface CustodyPlatform {
  id: string;
  name: string;
  category: PlatformCategory;
  country: string;
  /** Any of these must match the normalized shareholder name. */
  match: RegExp[];
  /** All of these must also match (used for funds). */
  requires?: RegExp[];
}

const VPF = /VERDIPAPIRFOND/;
const fund = (id: string, name: string, match: RegExp[]): CustodyPlatform => ({
  id,
  name,
  category: "fund",
  country: "NO",
  match,
  requires: [VPF],
});

export const CUSTODY_PLATFORMS: CustodyPlatform[] = [
  // ── Retail / online brokers ───────────────────────────────────────────────
  { id: "nordnet", name: "Nordnet", category: "retail", country: "SE", match: [/^NORDNET (BANK|LIVSFORSIKRING)\b/] },
  { id: "avanza", name: "Avanza", category: "retail", country: "SE", match: [/^AVANZA BANK\b/] },
  { id: "saxo", name: "Saxo Bank", category: "retail", country: "DK", match: [/^SAXO BANK\b/, /^DELISTED STOCKS SAXO BANK\b/] },
  { id: "interactive_brokers", name: "Interactive Brokers", category: "retail", country: "US", match: [/^INTERACTIVE BROKERS\b/] },
  { id: "degiro", name: "DEGIRO / flatexDEGIRO", category: "retail", country: "DE", match: [/^(FLATEX ?)?DEGIRO\b/] },
  { id: "revolut", name: "Revolut", category: "retail", country: "LT", match: [/^REVOLUT\b/] },
  { id: "etoro", name: "eToro", category: "retail", country: "CY", match: [/^ETORO\b/] },
  { id: "swissquote", name: "Swissquote", category: "retail", country: "CH", match: [/^SWISSQUOTE\b/] },
  { id: "lightyear", name: "Lightyear", category: "retail", country: "EE", match: [/^LIGHTYEAR\b/] },
  { id: "trading212", name: "Trading 212", category: "retail", country: "GB", match: [/^TRADING ?212\b/] },

  // ── Nordic brokers (before banks so "DNB CARNEGIE" is not caught by DNB) ─
  { id: "dnb_carnegie", name: "DNB Carnegie", category: "nordic_broker", country: "SE", match: [/^DNB CARNEGIE\b/, /^CARNEGIE (INVESTMENT BANK|AS|AB)\b/] },
  { id: "pareto", name: "Pareto Securities", category: "nordic_broker", country: "NO", match: [/^PARETO SECURITIES\b/] },
  { id: "arctic", name: "Arctic Securities", category: "nordic_broker", country: "NO", match: [/^ARCTIC SECURITIES\b/] },
  { id: "sb1_markets", name: "SpareBank 1 Markets", category: "nordic_broker", country: "NO", match: [/^SB1 MARKETS\b/, /^SPAREBANK 1 MARKETS\b/] },
  { id: "norne", name: "Norne Securities", category: "nordic_broker", country: "NO", match: [/^NORNE SECURITIES\b/] },
  { id: "clarksons", name: "Clarksons Securities", category: "nordic_broker", country: "NO", match: [/^CLARKSONS (PLATOU )?SECURITIES\b/] },
  { id: "fearnley", name: "Fearnley Securities", category: "nordic_broker", country: "NO", match: [/^FEARNLEY SECURITIES\b/] },
  { id: "abg", name: "ABG Sundal Collier", category: "nordic_broker", country: "NO", match: [/^ABG SUNDAL COLLIER\b/] },

  // ── Private banks (before broader bank rules) ─────────────────────────────
  { id: "ubs_wealth", name: "UBS Wealth Management", category: "private_bank", country: "CH", match: [/^UBS (SWITZERLAND|EUROPE SE|FINANCIAL SERVICES)\b/] },
  { id: "citi_private", name: "Citibank (Switzerland)", category: "private_bank", country: "CH", match: [/^CITIBANK \(SWITZERLAND\)/] },
  { id: "dnb_luxembourg", name: "DNB Luxembourg", category: "private_bank", country: "LU", match: [/^DNB LUXEMBOURG\b/] },
  { id: "julius_baer", name: "Julius Bär", category: "private_bank", country: "CH", match: [/^BANK JULIUS BA(E)?R\b/] },
  { id: "pictet", name: "Pictet", category: "private_bank", country: "CH", match: [/^(BANK|BANQUE) PICTET\b/] },
  { id: "ubp", name: "Union Bancaire Privée", category: "private_bank", country: "CH", match: [/^UNION BANCAIRE PRIVEE\b/] },
  { id: "lgt", name: "LGT Bank", category: "private_bank", country: "LI", match: [/^LGT BANK\b/] },
  { id: "banque_de_luxembourg", name: "Banque de Luxembourg", category: "private_bank", country: "LU", match: [/^BANQUE DE LUXEMBOURG\b/] },
  { id: "bcv", name: "Banque Cantonale Vaudoise", category: "private_bank", country: "CH", match: [/^BANQUE CANTONALE VAUDOISE\b/] },
  { id: "dz_privatbank", name: "DZ Privatbank", category: "private_bank", country: "LU", match: [/^DZ PRIVATBANK\b/] },
  { id: "degroof", name: "Degroof Petercam", category: "private_bank", country: "BE", match: [/^BANQUE DEGROOF\b/] },
  { id: "lombard_odier", name: "Lombard Odier", category: "private_bank", country: "CH", match: [/^(BANQUE )?LOMBARD ODIER\b/] },
  { id: "vontobel", name: "Vontobel", category: "private_bank", country: "CH", match: [/^(BANK )?VONTOBEL\b/] },
  { id: "edmond_de_rothschild", name: "Edmond de Rothschild", category: "private_bank", country: "CH", match: [/^((BANQUE|BANK) )?EDMOND DE ROTHSCHILD\b/] },
  { id: "schoellerbank", name: "Schoellerbank", category: "private_bank", country: "AT", match: [/^SCHOELLERBANK\b/] },
  { id: "thaler", name: "Banque Thaler", category: "private_bank", country: "CH", match: [/^BANQUE THALER\b/] },

  // ── Investment banks / prime brokers (before custody rules of the same group) ─
  { id: "hsbc_market_making", name: "HSBC market making", category: "investment_bank", country: "GB", match: [/^MARKET-MAKING\b/] },
  { id: "bnp_markets", name: "BNP Paribas Financial Markets", category: "investment_bank", country: "FR", match: [/^BNP PARIBAS (FINANCIAL MARKETS|ARBITRAGE|PRIME)\b/] },
  { id: "jpm_securities", name: "J.P. Morgan Securities", category: "investment_bank", country: "GB", match: [/^J\.? ?P\.? ?MORGAN SECURITIES\b/] },
  { id: "morgan_stanley", name: "Morgan Stanley", category: "investment_bank", country: "GB", match: [/^MORGAN STANLEY\b/] },
  { id: "goldman_sachs", name: "Goldman Sachs", category: "investment_bank", country: "GB", match: [/^GOLDMAN,? SACHS\b/] },
  { id: "bofa_merrill", name: "BofA / Merrill Lynch", category: "investment_bank", country: "GB", match: [/^MERRILL LYNCH\b/, /^BOFAS?\b/] },
  { id: "barclays", name: "Barclays", category: "investment_bank", country: "GB", match: [/^BARCLAYS\b/] },
  { id: "citigroup_markets", name: "Citigroup Global Markets", category: "investment_bank", country: "GB", match: [/^CITIGROUP GLOBAL MARKETS\b/] },
  { id: "ubs_ib", name: "UBS Investment Bank", category: "investment_bank", country: "GB", match: [/^UBS AG\b/] },
  { id: "deutsche_bank", name: "Deutsche Bank", category: "investment_bank", country: "DE", match: [/^DEUTSCHE BANK\b/] },
  { id: "societe_generale", name: "Société Générale", category: "investment_bank", country: "FR", match: [/^SOCIETE GENERALE( S\.?A\.?)?$/] },
  { id: "jefferies", name: "Jefferies", category: "investment_bank", country: "US", match: [/^JEFFERIES\b/] },
  { id: "nomura", name: "Nomura", category: "investment_bank", country: "JP", match: [/^NOMURA\b/] },

  // ── Global custodians ─────────────────────────────────────────────────────
  { id: "bny_mellon", name: "BNY Mellon", category: "global_custody", country: "US", match: [/^(THE )?BANK OF NEW YORK MELLON\b/, /^BNY MELLON\b/] },
  { id: "pershing", name: "Pershing (BNY)", category: "global_custody", country: "US", match: [/^PERSHING\b/] },
  { id: "state_street", name: "State Street", category: "global_custody", country: "US", match: [/^STATE STREET\b/] },
  { id: "northern_trust", name: "Northern Trust", category: "global_custody", country: "US", match: [/^(THE )?NORTHERN TRUST\b/] },
  { id: "jpmorgan_custody", name: "J.P. Morgan (depot)", category: "global_custody", country: "US", match: [/^JPMORGAN CHASE\b/, /^J\.? ?P\.? ?MORGAN (CHASE|BANK|SE)\b/] },
  { id: "citibank", name: "Citibank", category: "global_custody", country: "US", match: [/^CITIBANK\b/] },
  { id: "bnp_paribas", name: "BNP Paribas Securities Services", category: "global_custody", country: "FR", match: [/^BNP PARIBAS( SECURITIES SERVICES| S\.?A\.?)?$/] },
  { id: "caceis", name: "CACEIS", category: "global_custody", country: "FR", match: [/^CACEIS\b/] },
  { id: "rbc", name: "RBC Investor Services", category: "global_custody", country: "CA", match: [/^RBC INVESTOR SERVICES\b/] },
  { id: "bbh", name: "Brown Brothers Harriman", category: "global_custody", country: "US", match: [/^BROWN BROTHERS HARRIMAN\b/] },
  { id: "hsbc", name: "HSBC", category: "global_custody", country: "GB", match: [/^HSBC\b/, /^HONGKONG AND SHANGHAI BANKING\b/] },
  { id: "socgen_securities_services", name: "SG Securities Services", category: "global_custody", country: "FR", match: [/^SOCIETE GENERALE SEC(\.|URITIES)? ?SERVICES\b/] },
  { id: "abn_amro", name: "ABN AMRO Clearing & Custody", category: "global_custody", country: "NL", match: [/^ABN AMRO\b/] },
  { id: "us_bank", name: "U.S. Bank", category: "global_custody", country: "US", match: [/^U\.? ?S\.? BANK NATIONAL\b/] },
  { id: "sumitomo_trust", name: "Sumitomo Mitsui Trust", category: "global_custody", country: "JP", match: [/^SUMITOMO MITSUI TRUST\b/] },
  { id: "mizuho_trust", name: "Mizuho Trust", category: "global_custody", country: "JP", match: [/^MIZUHO TRUST\b/] },

  // ── Nordic banks ──────────────────────────────────────────────────────────
  { id: "dnb", name: "DNB Bank", category: "nordic_bank", country: "NO", match: [/^DNB BANK\b/] },
  { id: "nordea", name: "Nordea", category: "nordic_bank", country: "FI", match: [/^NORDEA BANK\b/] },
  { id: "danske_bank", name: "Danske Bank", category: "nordic_bank", country: "DK", match: [/^DANSKE BANK\b/] },
  { id: "handelsbanken", name: "Handelsbanken", category: "nordic_bank", country: "SE", match: [/^(SVENSKA )?HANDELSBANKEN\b/] },
  { id: "seb", name: "SEB", category: "nordic_bank", country: "SE", match: [/^SKANDINAVISKA ENSKILDA BANKEN\b/, /^SEB\b/, /^(AS|AB) SEB\b/] },
  { id: "swedbank", name: "Swedbank", category: "nordic_bank", country: "SE", match: [/^SWEDBANK\b/] },
  { id: "landsbankinn", name: "Landsbankinn", category: "nordic_bank", country: "IS", match: [/^LANDSBANKINN\b/] },
  { id: "islandsbanki", name: "Íslandsbanki", category: "nordic_bank", country: "IS", match: [/^ISLANDSBANKI\b/] },
  { id: "arion", name: "Arion banki", category: "nordic_bank", country: "IS", match: [/^ARION BANKI\b/] },

  // ── European universal banks ──────────────────────────────────────────────
  { id: "commerzbank", name: "Commerzbank", category: "european_bank", country: "DE", match: [/^COMMERZBANK\b/] },
  { id: "kbc", name: "KBC Bank", category: "european_bank", country: "BE", match: [/^KBC BANK\b/] },
  { id: "intesa", name: "Intesa Sanpaolo", category: "european_bank", country: "IT", match: [/^INTESA SANPAOLO\b/] },
  { id: "raiffeisen", name: "Raiffeisen Bank International", category: "european_bank", country: "AT", match: [/^RAIFFEISEN BANK\b/] },
  { id: "unicredit", name: "UniCredit", category: "european_bank", country: "IT", match: [/^UNICREDIT\b/] },
  { id: "ing", name: "ING Bank", category: "european_bank", country: "NL", match: [/^ING BANK\b/] },

  // ── Settlement infrastructure ─────────────────────────────────────────────
  { id: "clearstream", name: "Clearstream", category: "infrastructure", country: "LU", match: [/^CLEARSTREAM\b/] },
  { id: "euroclear", name: "Euroclear", category: "infrastructure", country: "BE", match: [/^EUROCLEAR\b/] },
  { id: "six", name: "SIX SIS / x-clear", category: "infrastructure", country: "CH", match: [/^SIX (SIS|X-CLEAR)\b/] },
  { id: "lch", name: "LCH", category: "infrastructure", country: "GB", match: [/^LCH\b/] },
  { id: "euroccp", name: "EuroCCP (Cboe)", category: "infrastructure", country: "NL", match: [/^EUROPEAN CENTRAL COUNTERPARTY\b/] },

  // ── Norwegian mutual funds (own-name holdings, grouped by manager) ───────
  fund("fund_delphi", "Delphi Fondene", [/\bDELPHI\b/]),
  fund("fund_storebrand", "Storebrand Asset Management", [/\bSTOREBRAND\b/]),
  fund("fund_dnb", "DNB Asset Management", [/\bDNB\b/]),
  fund("fund_klp", "KLP Kapitalforvaltning", [/\bKLP\b/]),
  fund("fund_alfred_berg", "Alfred Berg", [/\bALFRED BERG\b/]),
  fund("fund_nordea", "Nordea Funds", [/\bNORDEA\b/]),
  fund("fund_odin", "ODIN Forvaltning", [/\bODIN\b/]),
  fund("fund_holberg", "Holberg Fondene", [/\bHOLBERG\b/]),
  fund("fund_pareto", "Pareto Asset Management", [/\bPARETO\b/]),
  fund("fund_skagen", "SKAGEN", [/\bSKAGEN\b/]),
  fund("fund_eika", "Eika Kapitalforvaltning", [/\bEIKA\b/]),
  fund("fund_first", "FIRST Fondene", [/\bFIRST\b/]),
  fund("fund_fondsfinans", "Fondsfinans Kapitalforvaltning", [/\bFONDSFINANS\b/]),
  fund("fund_heimdal", "Heimdal Fondsforvaltning", [/\bHEIMDAL\b/]),
  fund("fund_danske_invest", "Danske Invest", [/\bDANSKE INVEST\b/]),
  fund("fund_handelsbanken", "Handelsbanken Fonder", [/\bHANDELSBANKEN\b/]),
  fund("fund_sparebank1", "SpareBank 1 Forvaltning", [/\bSPAREBANK 1\b/]),
  fund("fund_c_worldwide", "C WorldWide", [/\bC WORLDWIDE\b/]),
  fund("fund_borea", "Borea Asset Management", [/\bBOREA\b/]),
  fund("fund_equinor", "Equinor Asset Management", [/\bEQUINOR\b/]),
  fund("fund_arctic", "Arctic Fund Management", [/\bARCTIC\b/]),
  fund("fund_norne", "Norne Forvaltning", [/\bNORNE\b/]),
  fund("fund_vibrand", "Vibrand Kapitalforvaltning", [/\bVIBRAND\b/]),
  fund("fund_other", "Andre norske verdipapirfond", [/./]),
];

export const PLATFORM_BY_ID: Record<string, CustodyPlatform> = Object.fromEntries(
  CUSTODY_PLATFORMS.map((p) => [p.id, p]),
);

/** Upper-cases, strips diacritics (É→E, Ä→A; Ø/Æ are kept) and collapses whitespace. */
export function normalizeShareholderName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** In the register, persons carry their birth year (4 digits) in the "Fødselsår/orgnr" column. */
export function isPersonShareholder(idField: string | number | null | undefined): boolean {
  if (idField == null) return false;
  return /^\d{4}$/.test(String(idField).trim());
}

/**
 * Returns the platform operating the shareholder account, or null when the shareholder is
 * a person or an ordinary company/investor that is not a known platform.
 */
export function classifyShareholder(
  name: string | null | undefined,
  idField?: string | number | null,
): CustodyPlatform | null {
  if (isPersonShareholder(idField)) return null;
  const n = normalizeShareholderName(name);
  if (!n) return null;
  for (const p of CUSTODY_PLATFORMS) {
    if (p.requires && !p.requires.every((r) => r.test(n))) continue;
    if (p.match.some((r) => r.test(n))) return p;
  }
  return null;
}

export function categoryOf(platformId: string | null | undefined): CategoryInfo | null {
  if (!platformId) return null;
  const p = PLATFORM_BY_ID[platformId];
  return p ? PLATFORM_CATEGORIES[p.category] : null;
}
