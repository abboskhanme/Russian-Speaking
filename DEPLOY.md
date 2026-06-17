# Deploy — Azure B1S VM + DuckDNS + HTTPS (staging/test)

Goal: a public HTTPS URL so the **microphone works on every device** (HTTPS =
secure context) and you can test on real phones.

> ⚠️ B1S = 1 vCPU / **1 GB RAM**. This stack (Postgres + Redis + MinIO + backend +
> worker + nginx) is heavy for 1 GB. **Swap is mandatory** (step 2) and we run
> only 1 process each (`BACKEND_WORKERS=1`, `WORKER_CONCURRENCY=1`). Expect it to
> be usable for testing, not fast.

---

## 1. Create the VM
- Azure Portal → Create a VM → **Ubuntu 22.04 LTS**, size **B1s**.
- Networking → open inbound ports: **22 (SSH), 80 (HTTP), 443 (HTTPS)**.
- Note the VM's **public IP**.

SSH in:
```bash
ssh azureuser@<VM_PUBLIC_IP>
```

## 2. Swap + Docker (run on the VM)
```bash
# 2 GB swap — without this the stack will OOM on 1 GB RAM
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Docker + compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# log out and back in so the group applies, then verify:
docker compose version
```

## 3. DuckDNS subdomain
1. Go to https://www.duckdns.org → sign in → create a subdomain, e.g. `russpeak`.
2. Set its IP to your **VM public IP** (the "current ip" field) and Update.
3. Your domain is now `russpeak.duckdns.org`. Verify: `ping russpeak.duckdns.org`
   resolves to the VM IP.

## 4. Get the code on the VM
```bash
git clone <your-repo-url> russpeak && cd russpeak
# (or scp the project folder up)
```

## 5. Production `.env`
Create `.env` in the project root. Start from `.env.example` and set these for
production (replace the domain + secrets + keys):
```bash
ENV=production
SECRET_KEY=<long-random-string>            # change me!
BACKEND_CORS_ORIGINS=https://russpeak.duckdns.org

POSTGRES_PASSWORD=<strong-password>

# Object storage (MinIO behind nginx) — PUBLIC url is the HTTPS domain, the
# internal endpoint stays the docker service name.
S3_ENDPOINT_URL=http://minio:9000
S3_PUBLIC_URL=https://russpeak.duckdns.org
S3_ACCESS_KEY=<strong-key>
S3_SECRET_KEY=<strong-secret>
S3_BUCKET=russpeak-media                    # keep in sync with nginx.conf location

# AI keys
AZURE_SPEECH_KEY=<...>
AZURE_SPEECH_REGION=germanywestcentral
GEMINI_API_KEY=<...>
OPENAI_API_KEY=<...>                        # optional fallback

# Google sign-in (optional) — add the https domain as an authorized origin (step 8)
GOOGLE_CLIENT_ID=<...>

# 1 GB RAM tuning — keep these LOW
BACKEND_WORKERS=1
WORKER_CONCURRENCY=1
LOG_JSON=true
```
> If `S3_BUCKET` is not `russpeak-media`, update the `location /russpeak-media/`
> path in `nginx/nginx.conf` to match.

## 6. HTTPS certificate (Let's Encrypt, dockerized — no installs)
nginx isn't running yet, so certbot can use port 80 directly:
```bash
docker run --rm -p 80:80 \
  -v "$PWD/letsencrypt:/etc/letsencrypt" \
  certbot/certbot certonly --standalone \
  -d russpeak.duckdns.org \
  --non-interactive --agree-tos -m you@example.com

# nginx mounts ./nginx/certs read-only — copy the real files in (not symlinks):
mkdir -p nginx/certs
sudo cp letsencrypt/live/russpeak.duckdns.org/fullchain.pem nginx/certs/fullchain.pem
sudo cp letsencrypt/live/russpeak.duckdns.org/privkey.pem  nginx/certs/privkey.pem
```

## 7. Launch
```bash
docker compose -f docker-compose.prod.yml up -d --build
# migrations run automatically (the `migrate` service). Check health:
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend
```
Open **https://russpeak.duckdns.org** — the mic now works on any device. 🎤

(Optional) seed demo data:
```bash
docker compose -f docker-compose.prod.yml run --rm backend python -m app.scripts.seed_demo
```

## 8. Google sign-in (if used)
Google Cloud Console → Credentials → your OAuth Web client → add to
**Authorized JavaScript origins**: `https://russpeak.duckdns.org`.

## 9. Certificate renewal (every ~90 days)
```bash
docker run --rm -p 80:80 -v "$PWD/letsencrypt:/etc/letsencrypt" \
  certbot/certbot renew
sudo cp letsencrypt/live/russpeak.duckdns.org/fullchain.pem nginx/certs/fullchain.pem
sudo cp letsencrypt/live/russpeak.duckdns.org/privkey.pem  nginx/certs/privkey.pem
docker compose -f docker-compose.prod.yml restart web
```
(certbot `renew` needs port 80 free for a moment; if nginx holds it, run
`docker compose -f docker-compose.prod.yml stop web` first, then `start web` after.)

---

### Troubleshooting
- **Out of memory / containers killed**: confirm swap is on (`free -h`), keep
  `BACKEND_WORKERS=1` and `WORKER_CONCURRENCY=1`. Consider a bigger VM (B2s, 4 GB)
  if it's too slow.
- **Audio won't upload/play**: `S3_PUBLIC_URL` must be exactly `https://<domain>`
  (no port), and the `nginx.conf` media location must match `S3_BUCKET`.
- **Cert errors**: DuckDNS must point to the VM IP and ports 80/443 must be open
  in the Azure NSG.
