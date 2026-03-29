# Costa Capital CRM

Koper CRM voor hotel & horecavastgoed — Spanje & West-Europa.

## Deployment op crm.costacapital.pro

### 1. GitHub repo aanmaken
Maak een nieuwe repo aan op GitHub, bijv. `costa-capital-crm`.
Upload deze drie bestanden:
- `index.html`
- `netlify.toml`
- `netlify/functions/sheets.js`

### 2. Netlify koppelen
1. Ga naar [netlify.com](https://netlify.com) → New site → Import from Git
2. Kies de `costa-capital-crm` repo
3. Build settings: alles leeg laten (geen build command nodig)
4. Klik Deploy

### 3. Environment variable instellen (API key veilig opslaan)
1. Netlify → Site settings → Environment variables
2. Voeg toe: `GOOGLE_SHEETS_API_KEY` = `AIzaSyAzbWI-oUu9FRHWWZXn8DFobd_-lnOkv-k`
3. Redeploy

### 4. Subdomein koppelen
1. Netlify → Domain settings → Add domain → `crm.costacapital.pro`
2. Voeg bij Cloudflare (waar costacapital.pro staat) een CNAME toe:
   - Name: `crm`
   - Value: jouw netlify url (bijv. `amazing-name-123.netlify.app`)

### 5. Google Sheets API key beperken
In Google Cloud Console → Credentials → API key bewerken:
- Application restrictions → Websites
- Voeg toe: `https://crm.costacapital.pro/*`

## Toegang voor Hans
Stuur Hans simpelweg de link: `https://crm.costacapital.pro`
Geen login nodig — de Google Sheet is de gedeelde database.
