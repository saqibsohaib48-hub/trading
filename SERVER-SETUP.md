# Scalp Radar – shared server setup

One server runs the scanner, both demo accounts and the Trade Agent **24/7, even when nobody has the page open**.
Every device that opens the server's address sees **the same live results**. Anyone with the link can watch;
changing settings, resetting a demo, closing a trade or applying an agent decision needs the **owner PIN**.

Files that must be in the same folder:
`server.js`, `package.json`, `scalp-radar.html`, `agent.html`, `agent-core.js`, `server-config.js`, `start-windows.bat`

The server needs **Node.js 18 or newer** (https://nodejs.org, pick "LTS").
On first start it prints the **owner PIN** and saves it in `data/config.json`. All results are saved in `data/state.json`.

---

## Option A – a small cloud server (recommended: runs even when your PC is off)

Any Linux VPS with 1 GB RAM works (about $4–6 a month).
**Pick a region outside the USA** (for example Singapore, Frankfurt or the UAE): Binance blocks US server addresses.

1. Create an Ubuntu server and log in with SSH.
2. Install Node.js:
   ```
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
3. Upload the folder (for example with WinSCP) to `/opt/scalp-radar`, then:
   ```
   cd /opt/scalp-radar
   npm install
   sudo npm install -g pm2
   pm2 start server.js --name scalp-radar
   pm2 save && pm2 startup        # starts again after a reboot
   ```
4. Allow port 8080 in the provider's firewall (and `sudo ufw allow 8080` if ufw is on).
5. Open `http://YOUR-SERVER-IP:8080` on any device. The agent is at `http://YOUR-SERVER-IP:8080/agent.html`.

Useful: `pm2 logs scalp-radar` shows the log and the PIN · `pm2 restart scalp-radar` after uploading new files.

## Option B – your own Windows PC (free, but the PC must stay on)

1. Install Node.js LTS from https://nodejs.org.
2. Double-click `start-windows.bat`. The window shows the owner PIN. Keep it open.
3. In Windows power settings, set **Sleep: Never**, or the scanner stops when the PC sleeps.
4. Open it:
   - on this PC: `http://localhost:8080`
   - on a phone or PC on the same Wi-Fi: `http://THIS-PC-IP:8080` (find the IP with `ipconfig`; allow Node.js through the Windows firewall when asked)
   - from anywhere: install Cloudflare Tunnel (`winget install Cloudflare.cloudflared`), then run
     `cloudflared tunnel --url http://localhost:8080` and open the `https://….trycloudflare.com` address it prints.
     That free address changes each time the tunnel restarts; a fixed one needs a (free) Cloudflare account and your own domain.

## Keeping your GitHub Pages link

If you want your GitHub Pages address to show the server's results too, the server needs an **https** address
(a Cloudflare Tunnel gives you one). Put it in `server-config.js` on GitHub:
```
window.SR_SERVER = 'https://your-address.trycloudflare.com';
```

## Notes

- **Change the PIN:** edit `data/config.json`, then restart the server. Five wrong PINs lock that device out for 10 minutes.
- **Updating:** replace the html/js files and restart. Your results in `data/` are kept.
- **Opening the html file directly** (without the server) still works as before, but then that browser runs its own separate copy.
- Demo only: the server never places real orders and holds no exchange keys.
