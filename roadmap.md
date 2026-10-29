# Roadmap

## Bakgrunnseksport
- [ ] Admin-låst, varig eksportkø med puljevise CSV-filer i privat Cloud Storage; ingen reimport.
- [ ] Eierportefølje og Playbook: start eksport, fremdrift, gjenopptakelse og nedlasting i arkivet.
- [ ] Tester og innlogget gjennomgang av eksport og tilgangsvern.

## Eksportgrense
- [x] Personeiere og Playbook Studio: eksport opptil 500 000 filtrerte rader, puljevis henting; 8 tester grønne, CSV-nedlastinger og paginering over 1 000 verifisert med eiertilgang, anonym personeksport blokkert; ingen reimport.

## Eierportefølje
- [x] Årstabeller 2017–2025 og sammenligning per person; 14 tester grønne, eierflyt med ni tabeller og CSV verifisert. 2017–2021 markeres ikke innlastet.

## In progress — Plattformer & VPS (hvilke aksjonærer handler via hvilke plattformer)
- [x] Årstabeller og sammenligning 2017–2025, med tydelig markering av ikke innlastede år (27 tester grønne; ni tabeller, personeiere per år og mobilvisning verifisert)
- [x] Navngitte personeiere og full tilgjengelig eierandelshistorikk i VPS-eierprofilen (alle beholdninger, paginering, søk)
- [x] Historiske eierskapssignaler 2022–2025 koblet til playbooks og eksport (23 tester grønne; eierprofil → playbook → CSV, filtre og innloggingsvern verifisert)
- [x] Plattformkatalog + klassifisering av forvalterkontoer (nominee) med tester (17 tester grønne)
- [x] Innlastingsskript for 2024 + 2025 skrevet (ikke kjørt ennå)
- [x] Databasetabeller + innlasting 2022–2025 (738 selskaper, 44 193 plattformposisjoner)

- [x] Ny side «VPS og meglere»: oversikt, selskap (eierandel, historie, profil), plattform
- [ ] Playbook Studio: plattformfiltre, nye playbooks (retail-momentum, utenlandsk institusjonell inngang), eksportkolonner
- [ ] Verifisere hele flyten i nettleseren

## Ready (next)
- Utvide plattformhistorikk med 2022–2023 for flerårige trender
- Plattform-merker på Companies-siden
- Doffin: bredere historisk innhenting og bedre navnematching (juridisk navn vs. handelsnavn)

## Blocked
- [x] Innlogging (kun eier) + lukket personeierliste (2024→2025, ≥5 %)
- [x] 4-års eierhistorikk 2022–2025 for alle personaksjonærer (3,76 mill. person–selskap-rader) på /eiere
- [x] Eierhistorikk 2017–2025 fra prosjektets lagring (shareholders), eksterne kilder fjernet
- [x] Plattform/VPS-tabeller 2017–2025 (89 107 posisjoner)
