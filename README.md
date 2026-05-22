# Mantrail Tracker

Real-time mantrailing session management platform with Google OAuth, live tracking, role-based hiding/search, session master route drawing, personal mantrailing log, dog management, and email allowlist access control.

## Prerequisites

- [Docker](https://docs.docker.com/engine/install/)
- A Google Cloud Console project with the **People API** enabled and an OAuth 2.0 Client ID (Desktop app type)

## Setup

### 1. Create `.env`

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```ini
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
JWT_SECRET=generate-a-random-secret-here
PORT=22334
```

- `GOOGLE_CLIENT_ID` — from Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID
- `JWT_SECRET` — any random string, used to sign session tokens. Generate one with `openssl rand -hex 32`
- `PORT` — internal port the server listens on (default `22334`)

### 2. Build the image

```bash
docker build -t mantrail-app .
```

### 3. Run the container

```bash
docker run -d \
  --name mantrail-app \
  --restart unless-stopped \
  --env-file .env \
  -p 22334:22334 \
  -v mantrail-data:/app/data \
  mantrail-app
```

| Flag | Purpose |
|------|---------|
| `-d` | Run in background |
| `--restart unless-stopped` | Auto-start on boot; don't restart after manual stop |
| `--env-file .env` | Inject secrets at runtime |
| `-p 22334:22334` | Map host port 22334 to container |
| `-v mantrail-data:/app/data` | Persist SQLite database + downloaded avatars |

### 4. Open the app

Visit `https://localhost:22334` in your browser. The app uses a self-signed certificate — your browser will show a warning; proceed anyway.

### First sign-in

The first Google account that signs in is automatically added to the allowlist with invite rights. After that, you can generate one-time invite links from **Access Management** → **Generate Invite Link** and share them with friends.

## Docker management

```bash
# View logs
docker logs -f mantrail-app

# Stop (won't restart due to unless-stopped)
docker stop mantrail-app

# Remove container
docker rm mantrail-app

# Delete all data (database, avatars)
docker volume rm mantrail-data
```
