# Resdagboken

Resdagbok för två: resor, färdmedel, dagbok, bilder och en animerad karta över hur man rest.

- Fungerar offline och synkar mot Supabase när nätet är tillbaka.
- Karta: OpenFreeMap (OpenStreetMap). Sökning: Photon. Rutter: FOSSGIS OSRM (bil, taxi, buss, cykel) och BRouter (tåg).
- Ingen byggprocess: statiska filer som publiceras med GitHub Pages.

## Första gången
1. Kör `supabase/schema.sql` i Supabase → SQL Editor.
2. Supabase → Authentication → Sign In / Providers → Email: stäng av **Confirm email**.
3. GitHub Pages: Settings → Pages → Deploy from branch → `main` / root.
