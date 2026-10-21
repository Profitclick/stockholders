import { describe, expect, it } from "vitest";
import { CUSTODY_PLATFORMS, PLATFORM_CATEGORIES, classifyShareholder, normalizeShareholderName } from "./custodyPlatforms";

const id = (name: string, ref = "200000000") => classifyShareholder(name, ref)?.id ?? null;

describe("classifyShareholder — retail platforms", () => {
  it("maps every Nordnet nominee account to Nordnet", () => {
    expect(id("NORDNET BANK AB")).toBe("nordnet");
    expect(id("NORDNET BANK NUF")).toBe("nordnet");
    expect(id("NORDNET LIVSFORSIKRING AS")).toBe("nordnet");
    expect(id("NORDNET LIVSFORSIKRING AS SUOMEN S")).toBe("nordnet");
  });

  it("maps Avanza, Saxo and Interactive Brokers", () => {
    expect(id("AVANZA BANK AB")).toBe("avanza");
    expect(id("SAXO BANK A/S")).toBe("saxo");
    expect(id("DELISTED STOCKS SAXO BANK AS")).toBe("saxo");
    expect(id("INTERACTIVE BROKERS LLC")).toBe("interactive_brokers");
  });

  it("does not match look-alike company names", () => {
    expect(id("AVANZARE CAPITAL AS")).toBeNull();
    expect(id("ARCTICA INVEST AS")).toBeNull();
    expect(id("GREEN ARCTIC INVEST AS")).toBeNull();
    expect(id("NORNE INVEST AS")).toBeNull();
  });
});

describe("classifyShareholder — banks, brokers and custodians", () => {
  it("separates DNB Carnegie (broker) from DNB Bank (bank) and DNB Luxembourg (private bank)", () => {
    expect(id("DNB CARNEGIE INVESTMENT BANK AB")).toBe("dnb_carnegie");
    expect(id("DNB BANK ASA", "984851006")).toBe("dnb");
    expect(id("DNB LUXEMBOURG S.A.")).toBe("dnb_luxembourg");
  });

  it("separates J.P. Morgan custody from J.P. Morgan Securities", () => {
    expect(id("JPMORGAN CHASE BANK, N.A., LONDON")).toBe("jpmorgan_custody");
    expect(id("J.P. MORGAN SE")).toBe("jpmorgan_custody");
    expect(id("J.P. MORGAN SECURITIES PLC")).toBe("jpm_securities");
    expect(id("J.P. MORGAN SECURITIES LLC")).toBe("jpm_securities");
  });

  it("separates Citibank private banking from Citibank custody", () => {
    expect(id("CITIBANK (SWITZERLAND) AG")).toBe("citi_private");
    expect(id("CITIBANK, N.A.")).toBe("citibank");
    expect(id("CITIBANK EUROPE PLC")).toBe("citibank");
  });

  it("separates BNP Paribas custody from BNP Paribas markets", () => {
    expect(id("BNP PARIBAS")).toBe("bnp_paribas");
    expect(id("BNP PARIBAS FINANCIAL MARKETS")).toBe("bnp_markets");
  });

  it("treats HSBC market making as investment bank and HSBC Bank as custody", () => {
    expect(id("MARKET-MAKING INNLAND HSBC BANK PLC")).toBe("hsbc_market_making");
    expect(id("HSBC BANK PLC")).toBe("hsbc");
    expect(id("HONGKONG AND SHANGHAI BANKING CORP")).toBe("hsbc");
  });

  it("handles accents and double spaces in registered names", () => {
    expect(id("BANK JULIUS BÄR & CO. AG")).toBe("julius_baer");
    expect(id("SOCIÉTÉ GÉNÉRALE")).toBe("societe_generale");
    expect(id("SOCIETE GENERALE SEC. SERVICES SPA")).toBe("socgen_securities_services");
    expect(id("NORDEA BANK  ABP")).toBe("nordea");
    expect(id("ÍSLANDSBANKI HF.")).toBe("islandsbanki");
  });

  it("maps UBS business lines to wealth management or investment bank", () => {
    expect(id("UBS SWITZERLAND AG")).toBe("ubs_wealth");
    expect(id("UBS EUROPE SE")).toBe("ubs_wealth");
    expect(id("UBS AG LONDON BRANCH")).toBe("ubs_ib");
  });

  it("maps settlement infrastructure", () => {
    expect(id("CLEARSTREAM BANKING S.A.")).toBe("clearstream");
    expect(id("EUROCLEAR BANK S.A./N.V.")).toBe("euroclear");
    expect(id("SIX X-CLEAR AG NUF")).toBe("six");
    expect(id("LCH.CLEARNET LIMITED")).toBe("lch");
  });
});

describe("classifyShareholder — funds and persons", () => {
  it("groups Norwegian mutual funds by manager", () => {
    expect(id("VERDIPAPIRFONDET DNB NORGE INDEKS")).toBe("fund_dnb");
    expect(id("VERDIPAPIRFONDET STOREBRAND INDEKS - NORGE")).toBe("fund_storebrand");
    expect(id("EIKA UTBYTTE - VERDIPAPIRFOND")).toBe("fund_eika");
    expect(id("VERDIPAPIRFONDET PARETO AKSJE NORGE")).toBe("fund_pareto");
    expect(id("VERDIPAPIRFONDET PLUSS AKSJE")).toBe("fund_other");
  });

  it("does not treat a fund manager's operating company as a fund", () => {
    expect(id("STOREBRAND LIVSFORSIKRING AS")).toBeNull();
    expect(id("PARETO SECURITIES AS")).toBe("pareto");
  });

  it("never classifies a person, even with a platform-like name", () => {
    expect(classifyShareholder("NORDNET BANK AB", "1975")).toBeNull();
    expect(classifyShareholder("INGRID EIKAAS UKKELBERG", "1961")).toBeNull();
  });

  it("only funds are own-name holders; every other category is a nominee account", () => {
    for (const p of CUSTODY_PLATFORMS) {
      expect(PLATFORM_CATEGORIES[p.category].isNominee).toBe(p.category !== "fund");
    }
  });

  it("has unique platform ids", () => {
    const ids = CUSTODY_PLATFORMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("normalizes names", () => {
    expect(normalizeShareholderName("  Bank Julius Bär  &  Co. ")).toBe("BANK JULIUS BAR & CO.");
    expect(normalizeShareholderName("SØLEN AS")).toBe("SØLEN AS");
  });
});
