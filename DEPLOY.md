# Step-by-step deployment guide

Follow these steps in order. You’ll use GitHub to get the code on your server, then configure Google, Cloudflare, and your website.

---

## Part 1: Get the code on your server (GitHub)

### 1.1 Push this project to GitHub (if you haven’t already)

- Create a new repository on GitHub (e.g. `elevated-roofing-chat`).
- On your **Windows machine** (where this folder lives), open a terminal in the project folder and run:

```bash
git init
git add .
git commit -m "Initial chat app"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

- Replace `YOUR_USERNAME` and `YOUR_REPO_NAME` with your GitHub username and repo name.
- **Do not** commit the file `elevated-roofing-website-chat-d56faccd129d.json` (it has secrets). Add it to `.gitignore` first (see below).

### 1.2 Ignore secrets in Git

Make sure your `.gitignore` includes (it already should):

```
.env
elevated-roofing-website-chat-*.json
```

If you use a different name for the service account JSON, add that pattern too. Then commit and push:

```bash
git add .gitignore
git commit -m "Ignore env and credentials"
git push
```

### 1.3 On your Ubuntu server: clone the repo

- SSH into your server (e.g. `ssh adam@elevateroofing`).
- Go to a folder where you keep projects (e.g. `~/projects` or `~/apps`).
- Clone the repo:

```bash
cd ~
# or: cd ~/projects
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git elevated-roofing-chat
cd elevated-roofing-chat
```

- Replace the URL with your real GitHub repo URL.

### 1.4 Put the Google service account file on the server

- The chat app needs the file `elevated-roofing-website-chat-d56faccd129d.json` on the server, but we don’t put it in Git.
- **Option A – SCP from your Windows machine:**

  On **Windows** (PowerShell or a terminal where you have the file):

  ```bash
  scp "C:\Users\adamr\Documents\Programs\Web Chat\elevated-roofing-website-chat-d56faccd129d.json" adam@YOUR_SERVER_IP:elevated-roofing-chat/
  ```

  Replace `YOUR_SERVER_IP` with your server’s IP or hostname. If you use a different path to the file, change the first path.

- **Option B – Copy-paste:** On the server, create the file manually:

  ```bash
  cd ~/elevated-roofing-chat
  nano elevated-roofing-website-chat-d56faccd129d.json
  ```

  Paste the **entire** contents of your JSON file (from your Windows project), save (Ctrl+O, Enter), and exit (Ctrl+X).

---

## Part 2: Google Cloud setup

Do this in [Google Cloud Console](https://console.cloud.google.com) with project **elevated-roofing-website-chat** selected.

### 2.1 Create OAuth consent screen (if not already done)

1. Go to **APIs & Services** → **OAuth consent screen**.
2. Choose **Internal** (only your Workspace) or **External** (if you want to test with a non-Workspace account).
3. Fill in App name (e.g. “Elevated Roofing Chat Admin”), support email, and developer contact. Save.

### 2.2 Create OAuth 2.0 Client ID for the admin login

1. Go to **APIs & Services** → **Credentials**.
2. Click **Create credentials** → **OAuth client ID**.
3. Application type: **Web application**.
4. Name: e.g. “Chat Admin”.
5. Under **Authorized redirect URIs**, click **Add URI** and add exactly:

   ```
   https://chat.elevatedroofingandsiding.com/auth/callback
   ```

6. Save. You’ll see a **Client ID** and **Client secret**. Copy both; you’ll put them in `.env` on the server.

### 2.3 Add the Chat app to your Google Chat space

1. In Google Chat, open the space you use for website chats (the one with URL containing `AAQAJjD8_Ho`).
2. Click the space name at the top → **Manage apps** / **Add apps** (wording may vary).
3. Find your Chat app (the one linked to your project, e.g. “Elevated Roofing Website Chat”) and add it to the space.
4. This lets the app post visitor messages and (with polling) see agent replies in that space.

---

## Part 3: Create `.env` on the server

On the **Ubuntu server**, in the project folder:

```bash
cd ~/elevated-roofing-chat
cp .env.example .env
nano .env
```

Fill in every value. Example (replace with your real values):

```env
BASE_URL=https://chat.elevatedroofingandsiding.com
GOOGLE_CHAT_SPACE_ID=AAQAJjD8_Ho
GOOGLE_CLIENT_ID=123456789-xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxx
ALLOWED_ADMIN_EMAILS=
ALLOWED_ADMIN_DOMAIN=elevatedroofingandsiding.com
SESSION_SECRET=your-long-random-string-here
CHAT_POLL_INTERVAL_MS=15000
```

- **GOOGLE_CLIENT_ID** and **GOOGLE_CLIENT_SECRET**: from step 2.2.
- **ALLOWED_ADMIN_EMAILS**: leave empty to allow any signed-in user, or comma-separated emails, e.g. `adam@elevatedroofingandsiding.com,jane@elevatedroofingandsiding.com`.
- **ALLOWED_ADMIN_DOMAIN**: e.g. `elevatedroofingandsiding.com` so only that domain can sign in (recommended).
- **SESSION_SECRET**: any long random string (e.g. run `openssl rand -hex 32` on the server and paste the result).

Save and exit (Ctrl+O, Enter, Ctrl+X).

---

## Part 4: Point Cloudflare at the chat app

You already use a Cloudflare Tunnel. Add one more public hostname for the chat app.

1. Log in to [Cloudflare Zero Trust](https://one.dash.cloudflare.com) (or your Cloudflare dashboard where Tunnels are configured).
2. Go to **Networks** → **Tunnels** (or **Access** → **Tunnels**).
3. Click your **existing tunnel** (the one running on the same Ubuntu server).
4. Open **Public Hostname** (or **Routing**).
5. Click **Add a hostname** (or **Add public hostname**).
6. Set:
   - **Subdomain**: `chat` (so the hostname is `chat.elevatedroofingandsiding.com`).
   - **Domain**: `elevatedroofingandsiding.com`.
   - **Service type**: **HTTP**.
   - **URL**: `localhost:3000` (because the Docker container will listen on 3000 on the same machine as the tunnel).
7. Save.

After you start the chat container (Part 5), traffic to `https://chat.elevatedroofingandsiding.com` will go through the tunnel to your server on port 3000.

---

## Part 5: Run the chat app with Docker

On the **Ubuntu server**:

```bash
cd ~/elevated-roofing-chat
docker compose up -d
```

Check that it’s running:

```bash
docker compose ps
docker compose logs -f chat
```

You should see something like “Chat server listening on port 3000”. Stop following logs with Ctrl+C.

If you need to update the app later (after you push changes to GitHub):

```bash
cd ~/elevated-roofing-chat
git pull
docker compose build --no-cache
docker compose up -d
```

---

## Part 6: Add the widget to your website

On the site **elevatedroofingandsiding.com** (wherever you edit the HTML – CMS, theme, or raw code), add this line before the closing `</body>` tag:

```html
<script src="https://chat.elevatedroofingandsiding.com/widget.js" async></script>
```

- The chat bubble will appear after a few seconds (delay is configurable in the admin).
- Visitors get one conversation each; their messages go to your Google Chat space in a thread per conversation; your team replies in that space, and replies show on the website (via polling).

---

## Part 7: Use the admin panel

1. Open in a browser: **https://chat.elevatedroofingandsiding.com/admin/**
2. Click **Sign in with Google** and sign in with your Workspace account (allowed by your domain or allowed-emails list).
3. You can:
   - See all conversations and whether someone has replied.
   - Open a conversation and send a reply (it saves in the app and posts to Google Chat).
   - Change **Widget settings**: delay before popup, welcome text, primary color, position (bottom-left / bottom-right).

---

## Checklist (quick reference)

- [ ] Repo pushed to GitHub; `.gitignore` excludes `.env` and `*.json` credentials.
- [ ] On server: repo cloned; `elevated-roofing-website-chat-d56faccd129d.json` copied into project folder.
- [ ] Google: OAuth consent screen configured; OAuth 2.0 Web client created; redirect URI `https://chat.elevatedroofingandsiding.com/auth/callback` added.
- [ ] Google Chat: app added to the website-chats space.
- [ ] On server: `.env` created from `.env.example` and filled (client ID, secret, domain, SESSION_SECRET).
- [ ] Cloudflare: public hostname `chat.elevatedroofingandsiding.com` → HTTP → `localhost:3000`.
- [ ] On server: `docker compose up -d`; container is running.
- [ ] Website: `<script src="https://chat.elevatedroofingandsiding.com/widget.js" async></script>` added.
- [ ] Admin: signed in at https://chat.elevatedroofingandsiding.com/admin/ and tested.

---

## Troubleshooting

- **Admin login fails or “redirect_uri_mismatch”**  
  The redirect URI in Google Cloud must be exactly `https://chat.elevatedroofingandsiding.com/auth/callback` (no trailing slash, correct domain).

- **Widget doesn’t load**  
  Check that `https://chat.elevatedroofingandsiding.com/widget.js` opens in a browser and that the tunnel is running and points to port 3000.

- **No replies from Google Chat on the website**  
  The app uses polling (about every 15 seconds). Make sure the Chat app is in the space and that your team is replying in the **same space** (in the thread for that conversation). If you don’t see threads, send the first message from the website so the thread is created.

- **“Credentials not found” in Docker**  
  The path in `docker-compose.yml` mounts the JSON from `./elevated-roofing-website-chat-d56faccd129d.json` in the project folder. Ensure that file exists on the server in `~/elevated-roofing-chat/` (or the path you use).
