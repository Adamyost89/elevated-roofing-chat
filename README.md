# Elevated Roofing Website Chat

Self-hosted website chat for elevatedroofingandsiding.com with Google Chat integration. One conversation per visitor, one thread per conversation in a single Google Chat space; agents reply in Google Chat; replies are synced to the website (via polling when Workspace Events API is unavailable).

## What to do first

**Use the full deployment guide:** [**DEPLOY.md**](DEPLOY.md) — step-by-step instructions for:

1. Pushing the project to GitHub and cloning it on your Ubuntu server  
2. Google Cloud (OAuth client, redirect URI, adding the Chat app to your space)  
3. Creating `.env` on the server with your secrets  
4. Configuring your Cloudflare Tunnel for `chat.elevatedroofingandsiding.com`  
5. Running the app with Docker  
6. Adding the widget script to your website  
7. Using the admin panel  

If you use GitHub to get code onto your server, follow **DEPLOY.md** from top to bottom.

## Prerequisites

- Docker and Docker Compose on your Ubuntu server  
- Google Cloud project (elevated-roofing-website-chat) with Chat API enabled  
- Service account JSON for the Chat app  
- OAuth 2.0 Web client for admin sign-in  
- Cloudflare Tunnel so `chat.elevatedroofingandsiding.com` points at this app  

## Quick reference (after setup)

- **Run on server:** `cd ~/elevated-roofing-chat && docker compose up -d`  
- **Update from GitHub:** `git pull && docker compose build --no-cache && docker compose up -d`  
- **Widget embed:** `<script src="https://chat.elevatedroofingandsiding.com/widget.js" async></script>`  
- **Admin:** https://chat.elevatedroofingandsiding.com/admin/  

## Local development

```bash
cd server
cp .env.example .env
# Edit .env: BASE_URL=http://localhost:3000, add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and credentials path
npm install
node index.js
```

Then open http://localhost:3000/admin/ and http://localhost:3000/widget.js (embed on a test page).

## Configuration

- **Widget**: delay, welcome text, primary color, and position are configurable in Admin → Widget settings.
- **Google Chat**: Ensure your Chat app (service account) is a member of the space and can create messages. The app posts visitor messages into a thread per conversation (threadKey = conversation id). Polling lists messages in the space and syncs agent replies; if Workspace Events API is set up, Pub/Sub push to `/events` is also supported.

## License

Private use for Elevated Roofing.
