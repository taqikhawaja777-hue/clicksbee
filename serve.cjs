const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Stitch Workforce Monitor Pro</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <style>
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            background: #0a0e1a;
            color: #e2e8f0;
            min-height: 100vh;
            overflow-x: hidden;
          }
          body::before {
            content: '';
            position: fixed;
            top: -40%; left: -20%;
            width: 70vw; height: 70vw;
            background: radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%);
            pointer-events: none;
            z-index: 0;
          }
          body::after {
            content: '';
            position: fixed;
            bottom: -30%; right: -15%;
            width: 60vw; height: 60vw;
            background: radial-gradient(circle, rgba(14,165,233,0.08) 0%, transparent 70%);
            pointer-events: none;
            z-index: 0;
          }
          .container { max-width: 960px; margin: 0 auto; padding: 60px 24px; position: relative; z-index: 1; }
          .header { text-align: center; margin-bottom: 56px; }
          .logo-row { display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 12px; }
          .logo-icon {
            width: 48px; height: 48px; border-radius: 14px;
            background: linear-gradient(135deg, #6366f1 0%, #818cf8 100%);
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 8px 24px -4px rgba(99,102,241,0.35);
          }
          .logo-icon svg { width: 26px; height: 26px; color: #fff; }
          h1 { font-size: 32px; font-weight: 800; color: #f1f5f9; letter-spacing: -0.02em; }
          .subtitle { color: #64748b; font-size: 16px; margin-top: 4px; }
          .status-bar {
            display: flex; align-items: center; justify-content: center; gap: 24px;
            margin-top: 24px; padding: 12px 24px;
            background: rgba(30,41,59,0.6); border: 1px solid rgba(51,65,85,0.5);
            border-radius: 9999px; display: inline-flex;
          }
          .status-item { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #94a3b8; }
          .status-dot { width: 8px; height: 8px; border-radius: 50%; }
          .status-dot.green { background: #22c55e; box-shadow: 0 0 8px rgba(34,197,94,0.5); }
          .status-dot.amber { background: #f59e0b; box-shadow: 0 0 8px rgba(245,158,11,0.4); }
          .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
          .card {
            background: rgba(15,23,42,0.7);
            border: 1px solid rgba(51,65,85,0.6);
            border-radius: 16px;
            padding: 28px;
            text-decoration: none; color: inherit; display: flex; flex-direction: column;
            transition: all 0.25s cubic-bezier(0.4,0,0.2,1);
            backdrop-filter: blur(8px);
            position: relative; overflow: hidden;
          }
          .card::before {
            content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
            background: linear-gradient(90deg, var(--accent), transparent);
            opacity: 0; transition: opacity 0.25s;
          }
          .card:hover {
            transform: translateY(-6px);
            border-color: var(--accent);
            box-shadow: 0 20px 40px -12px rgba(0,0,0,0.5), 0 0 0 1px var(--accent);
          }
          .card:hover::before { opacity: 1; }
          .card-icon {
            width: 44px; height: 44px; border-radius: 12px;
            display: flex; align-items: center; justify-content: center;
            margin-bottom: 16px;
          }
          .card-icon svg { width: 22px; height: 22px; }
          .badge {
            display: inline-block; padding: 4px 10px; border-radius: 9999px;
            font-size: 10px; font-weight: 700; text-transform: uppercase;
            letter-spacing: 0.6px; margin-bottom: 12px; width: fit-content;
          }
          .card h3 { font-size: 18px; font-weight: 700; color: #f1f5f9; margin-bottom: 8px; }
          .card p { font-size: 13px; color: #64748b; line-height: 1.6; flex: 1; }
          .card-arrow {
            display: flex; align-items: center; gap: 6px; margin-top: 16px;
            font-size: 13px; font-weight: 600; color: var(--accent);
            transition: gap 0.2s;
          }
          .card:hover .card-arrow { gap: 10px; }
          .footer { text-align: center; margin-top: 48px; color: #475569; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo-row">
              <div class="logo-icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              </div>
              <h1>Stitch Workforce Monitor Pro</h1>
            </div>
            <p class="subtitle">Employee monitoring &amp; productivity platform — all systems operational</p>
            <div style="display:flex;justify-content:center;margin-top:24px;">
              <div class="status-bar">
                <div class="status-item">
                  <span class="status-dot green"></span>
                  <span>Backend API <strong style="color:#e2e8f0">:3000</strong></span>
                </div>
                <div class="status-item">
                  <span class="status-dot green"></span>
                  <span>Frontend <strong style="color:#e2e8f0">:8080</strong></span>
                </div>
                <div class="status-item">
                  <span class="status-dot green"></span>
                  <span>MongoDB Atlas <strong style="color:#22c55e">Connected</strong></span>
                </div>
              </div>
            </div>
          </div>

          <div class="grid">

            <!-- Login -->
            <a class="card" href="/login/code.html" style="--accent:#6366f1;">
              <div class="card-icon" style="background:rgba(99,102,241,0.15);">
                <svg style="color:#818cf8;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
              </div>
              <span class="badge" style="background:rgba(99,102,241,0.2);color:#a5b4fc;">Authentication</span>
              <h3>Login</h3>
              <p>Sign in as Admin, Manager, or Employee with your credentials to access the monitoring platform.</p>
              <div class="card-arrow">Open Login →</div>
            </a>

            <!-- Sign Up -->
            <a class="card" href="/sign_up/code.html" style="--accent:#14b8a6;">
              <div class="card-icon" style="background:rgba(20,184,166,0.15);">
                <svg style="color:#2dd4bf;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
              </div>
              <span class="badge" style="background:rgba(20,184,166,0.2);color:#5eead4;">Registration</span>
              <h3>Sign Up</h3>
              <p>Create a new organization account. Register as Admin, Manager, or Employee with role-based onboarding.</p>
              <div class="card-arrow">Open Sign Up →</div>
            </a>

            <!-- Admin Dashboard -->
            <a class="card" href="/admin_dashboard/code.html" style="--accent:#f59e0b;">
              <div class="card-icon" style="background:rgba(245,158,11,0.15);">
                <svg style="color:#fbbf24;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
              </div>
              <span class="badge" style="background:rgba(245,158,11,0.2);color:#fcd34d;">Dashboard</span>
              <h3>Admin Dashboard</h3>
              <p>Employee attendance portal with check-in/out, break management, working hours tracking, and monthly stats.</p>
              <div class="card-arrow">Open Dashboard →</div>
            </a>

            <!-- Swagger API -->
            <a class="card" href="http://localhost:3000/api/docs" target="_blank" style="--accent:#22c55e;">
              <div class="card-icon" style="background:rgba(34,197,94,0.15);">
                <svg style="color:#4ade80;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              </div>
              <span class="badge" style="background:rgba(34,197,94,0.2);color:#86efac;">API Server</span>
              <h3>Swagger API Docs ↗</h3>
              <p>Interactive REST API documentation with 60+ endpoints — auth, employees, attendance, screenshots, and more.</p>
              <div class="card-arrow">Open Swagger ↗</div>
            </a>

          </div>

          <div class="footer">
            <p>Stitch Workforce Monitor Pro v1.0 &middot; NestJS + Prisma + MongoDB Atlas</p>
          </div>
        </div>
      </body>
      </html>
    `);
    return;
  }

  let filePath = path.join(ROOT, reqPath);
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    let ext = path.extname(filePath).toLowerCase();
    let contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});
