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
  '.json': 'application/json'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Stitch Workforce Monitor Pro</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; margin: 0; }
          .container { max-width: 1000px; margin: 0 auto; }
          h1 { color: #38bdf8; margin-bottom: 8px; font-size: 28px; }
          p { color: #94a3b8; font-size: 16px; margin-top: 0; }
          .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-top: 32px; }
          .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; transition: transform 0.2s, border-color 0.2s; text-decoration: none; color: inherit; display: block; }
          .card:hover { transform: translateY(-4px); border-color: #38bdf8; box-shadow: 0 10px 25px -5px rgba(56, 189, 248, 0.15); }
          .card h3 { margin: 0 0 8px 0; color: #f1f5f9; font-size: 18px; }
          .card p { margin: 0; font-size: 14px; color: #94a3b8; line-height: 1.5; }
          .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; background: #0284c7; color: white; margin-bottom: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🚀 Stitch Workforce Monitor Pro</h1>
          <p>Select a dashboard interface below to open and interact with the project:</p>
          <div class="grid">
            <a class="card" href="/admin_dashboard/code.html">
              <span class="badge">Dashboard</span>
              <h3>Admin Dashboard</h3>
              <p>High-level workforce overview, productivity metrics, and team management.</p>
            </a>
            <a class="card" href="/employee_dashboard/code.html">
              <span class="badge">Employee</span>
              <h3>Employee Dashboard</h3>
              <p>Personal time tracking, productivity logs, and break manager interface.</p>
            </a>
            <a class="card" href="/employee_detail_timeline/code.html">
              <span class="badge">Timeline</span>
              <h3>Employee Detail Timeline</h3>
              <p>Granular activity timeline, screenshots log, and application breakdown.</p>
            </a>
            <a class="card" href="/live_monitoring/code.html">
              <span class="badge">Real-time</span>
              <h3>Live Monitoring</h3>
              <p>Socket.IO powered real-time screen feeds and live activity monitor.</p>
            </a>
            <a class="card" href="/ethos_analytical/code.html">
              <span class="badge">Analytics</span>
              <h3>Ethos Analytical</h3>
              <p>Deep productivity analytics, category rules, and reporting graphs.</p>
            </a>
            <a class="card" href="http://localhost:3000/api/docs" target="_blank">
              <span class="badge" style="background:#10b981;">API Server</span>
              <h3>NestJS Swagger API Docs ↗</h3>
              <p>Complete backend REST API documentation on port 3000.</p>
            </a>
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
