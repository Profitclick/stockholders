import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { PersonOwnerTimeline } from "@/components/PersonOwnerTimeline";

type Profile = {
  signals: Record<string, any> | null;
  history: Record<string, any> | null;
  quote: Record<string, any> | null;
  short: Record<string, any> | null;
  flags: { title: string | null; published_time: string | null }[];
  platform: Record<string, any> | null;
};

const nf = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 });
const fmt = (v: unknown) => (v == null || v === "" ? "—" : typeof v === "number" ? nf.format(v) : String(v));

function Row({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm border-b border-border/50 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-right">{fmt(value)}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** 360° company view: register, financials, ownership signals, market data, short and flagging — all by orgnr. */
export function CompanyProfileSheet({ orgnr, onClose }: { orgnr: string | null; onClose: () => void }) {
  const [p, setP] = useState<Profile | null>(null);

  useEffect(() => {
    if (!orgnr) return;
    setP(null);
    (async () => {
      const [s, h, q, pl] = await Promise.all([
        supabase.from("company_signals").select("*").eq("orgnr", orgnr).maybeSingle(),
        supabase.from("historical_ownership_signals").select("*").eq("orgnr", orgnr).maybeSingle(),
        supabase.from("market_quotes").select("*").eq("orgnr", orgnr).maybeSingle(),
        supabase.from("company_platform_profile").select("year,total_shareholders,nominee_pct,retail_pct,direct_person_pct,direct_person_shift_pp,dominant_platform_id").eq("orgnr", orgnr).order("year", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const quote = q.data;
      const [sh, fl] = await Promise.all([
        quote ? supabase.from("short_positions").select("*").eq("isin", quote.isin).maybeSingle() : Promise.resolve({ data: null }),
        quote ? supabase.from("newsweb_flags").select("title,published_time").eq("issuer_sign", quote.symbol).order("published_time", { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
      ]);
      setP({ signals: s.data, history: h.data, quote, short: sh.data, flags: (fl.data as Profile["flags"]) ?? [], platform: pl.data });
    })();
  }, [orgnr]);

  const s = p?.signals;
  return (
    <Sheet open={!!orgnr} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{s?.name ?? p?.quote?.listed_name ?? orgnr}</SheetTitle>
          <SheetDescription className="font-mono">{orgnr} · {s?.industry ?? "—"} · {s?.municipality ?? "—"}</SheetDescription>
        </SheetHeader>
        {!p ? <Loader2 className="mt-6 h-5 w-5 animate-spin" /> : (
          <div className="mt-4 space-y-5">
            <Section title="Regnskap (siste innleverte)">
              <Row label="Omsetning" value={s?.revenue} />
              <Row label="Driftsresultat" value={s?.operating_profit} />
              <Row label="Margin %" value={s?.profit_margin} />
              <Row label="Egenkapital" value={s?.equity} />
              <Row label="Alder (år)" value={s?.company_age_years} />
              <Row label="Leadscore" value={s?.lead_score} />
            </Section>
            <Section title="Eiersignaler 2017–2025 (registerobservasjoner)">
              {p.history ? <>
                <Row label="Direkte personeiere" value={p.history.owner_count} />
                <Row label="Innganger / utganger" value={`${p.history.entry_count} / ${p.history.exit_count}`} />
                <Row label="Majoritetsskifter" value={p.history.majority_count} />
                <Row label="Økt / redusert ≥20 pp" value={`${p.history.increase_count} / ${p.history.decrease_count}`} />
              </> : <p className="text-sm text-muted-foreground">Ingen historiske personeiersignaler.</p>}
            </Section>
            <Section title="Eierhistorie per person">
              <PersonOwnerTimeline orgnr={orgnr!} />
            </Section>
            <Section title={`Depot- og eierprofil ${p.platform?.year ?? ""}`}>
              {p.platform ? <>
                <Row label="Aksjonærer" value={p.platform.total_shareholders} />
                <Row label="Forvalterandel %" value={p.platform.nominee_pct} />
                <Row label="Nettmegler-andel %" value={p.platform.retail_pct} />
                <Row label="Direkte personandel %" value={p.platform.direct_person_pct} />
                <Row label="Endring personandel (pp)" value={p.platform.direct_person_shift_pp} />
                <Row label="Største plattform" value={p.platform.dominant_platform_id} />
              </> : <p className="text-sm text-muted-foreground">Ikke VPS-registrert / ingen plattformdata.</p>}
            </Section>
            <Section title="Børs (Euronext)">
              {p.quote ? <>
                <Row label="Ticker" value={p.quote.symbol} />
                <Row label="Siste kurs" value={p.quote.last_price != null ? Number(p.quote.last_price) : null} />
                <Row label="Dagsomsetning" value={p.quote.turnover != null ? Number(p.quote.turnover) : null} />
                <Row label="Kursdato" value={p.quote.quote_date} />
                <Row label="Netto short %" value={p.short ? Number(p.short.short_pct) : null} />
                <Row label="Shortaktører" value={p.short?.holders} />
              </> : <p className="text-sm text-muted-foreground">Ikke notert, eller ikke koblet til kursdata.</p>}
            </Section>
            {p.quote && <Section title={`Flaggemeldinger NewsWeb (${p.flags.length})`}>
              {p.flags.length ? p.flags.map((f, i) => (
                <div key={i} className="text-xs py-1 border-b border-border/50"><span className="font-mono text-muted-foreground">{f.published_time?.slice(0, 10)}</span> {f.title}</div>
              )) : <p className="text-sm text-muted-foreground">Ingen flagg siste 90 dager.</p>}
            </Section>}
            <Section title="Tilskudd, anbud og roller">
              <div className="flex flex-wrap gap-1">
                {s?.skattefunn_count > 0 && <Badge variant="outline">SkatteFUNN ×{s.skattefunn_count}</Badge>}
                {s?.grants_count > 0 && <Badge variant="outline">Tilskudd ×{s.grants_count}</Badge>}
                {s?.eu_grants_count > 0 && <Badge variant="outline">EU ×{s.eu_grants_count}</Badge>}
                {s?.research_council_count > 0 && <Badge variant="outline">Forskningsrådet ×{s.research_council_count}</Badge>}
                {s?.contract_count > 0 && <Badge variant="outline">Doffin ×{s.contract_count}</Badge>}
              </div>
              <Row label="Daglig leder" value={s?.ceo_name} />
              <Row label="Styreleder" value={s?.chair_name} />
              <Row label="Nettside" value={s?.website} />
            </Section>
            <p className="text-[11px] text-muted-foreground">Kilder: Brønnøysund, Aksjonærregisteret (VPS), Euronext, Finanstilsynet SSR, Oslo Børs NewsWeb. Eierendringer er registerobservasjoner, ikke dokumenterte handler.</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
