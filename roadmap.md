# Roadmap

## In progress — Plattformer & VPS (hvilke aksjonærer handler via hvilke plattformer)
- [x] Plattformkatalog + klassifisering av forvalterkontoer (nominee) med tester (17 tester grønne)
- [x] Innlastingsskript for 2024 + 2025 skrevet (ikke kjørt ennå)
- [ ] Databasetabeller: custody_platforms, nominee_accounts, company_platform_holdings, company_platform_profile, platform_stats (kun lesetilgang for appen) + nye plattformkolonner i company_signals og refresh_company_signals
- [ ] Kjøre innlastingen (tørrkjøring først, deretter --upload) og sjekke tallene
- [ ] Ny side «Plattformer»: oversikt, plattform-drilldown, selskapsoppslag, plattformflyt, metode
- [ ] Playbook Studio: plattformfiltre, nye playbooks (retail-momentum, utenlandsk institusjonell inngang), eksportkolonner
- [ ] Verifisere hele flyten i nettleseren

## Ready (next)
- Utvide plattformhistorikk med 2022–2023 for flerårige trender
- Plattform-merker på Companies-siden
- Doffin: bredere historisk innhenting og bedre navnematching (juridisk navn vs. handelsnavn)

## Blocked
- Person-nivå lister (navngitte direkte VPS-eiere): krever innlogging/tilgangsstyring før personopplysninger kan vises — venter på brukerens beslutning
