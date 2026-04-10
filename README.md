# SiteCraft Prospect AI

This app now uses Apify as the prospect search engine instead of Google Places directly.

## What it does

1. Search businesses by location and niche through Apify.
2. Rank high-review businesses with no website.
3. Let you paste a demo site link.
4. Generate a WhatsApp-ready outreach message.
5. Optionally send the lead plus message into your own automation webhook.

## Run it

```powershell
.\start.ps1
```

Then open [http://localhost:3010](http://localhost:3010).

## Config

- `APIFY_TOKEN` and `APIFY_ACTOR_ID` can be stored in `.env`
- `APIFY_RUN_URL` is also supported as a fallback if you prefer pasting a run URL instead
- `OUTREACH_WEBHOOK_URL` is optional and enables automated dispatch into your own flow

## Notes

- A real live search triggers a fresh Apify actor run, so use it when you are ready.
- `.env` is ignored by `.gitignore` so your token stays local.

## Deploy on Netlify

This repo is now Netlify-ready.

1. Push this project to GitHub.
2. In Netlify, click `Add new site` -> `Import an existing project`.
3. Connect your GitHub repo and select this project.
4. Keep these deploy settings:
   - Base directory: leave empty
   - Build command: leave empty
   - Publish directory: `public`
5. In `Site configuration` -> `Environment variables`, add:
   - `APIFY_TOKEN`
   - `APIFY_ACTOR_ID`
   - `DEFAULT_CTA_LINK`
   - `OUTREACH_WEBHOOK_URL` if you want auto-dispatch
   - `WEBHOOK_SECRET` if your webhook verifies signatures
   - `APIFY_LANGUAGE` if you want a custom default
6. Deploy the site.

Netlify will serve the frontend from `public` and the API from these serverless functions:

- `/api/config`
- `/api/search`
- `/api/dispatch`

The routing is configured in [netlify.toml](./netlify.toml).

## Sources used for the implementation

- Apify Actor run API: https://docs.apify.com/api/v2/actor-run-get
- Apify Dataset items API: https://docs.apify.com/api/v2/dataset-items-get
- Apify Run actor synchronously and get dataset items: https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-get
