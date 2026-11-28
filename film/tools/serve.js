// Static server for the film stage, started by the tools on a free port. /app/* is the site itself
// (../public), so the film always renders the app as it is in this repository; everything else is
// served from this directory. SWIRL_APP=<dir> serves another build of the app instead.
const http = require('http'), fs = require('fs'), path = require('path');
const FILM = path.resolve(__dirname, '..');
const APP = process.env.SWIRL_APP ? path.resolve(process.env.SWIRL_APP) : path.resolve(FILM, '..', 'public');
const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff',
    '.wav': 'audio/wav', '.bin': 'application/octet-stream',
};
function start (port = 0) {
    const server = http.createServer((req, res) => {
        let p = decodeURIComponent(new URL(req.url, 'http://film').pathname);
        const root = p.startsWith('/app/') ? APP : FILM;
        if (root === APP) p = p.slice(4);
        const file = path.join(root, path.normalize(p));
        if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
        fs.readFile(file, (err, data) => {
            if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
            res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            res.end(data);
        });
    });
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => resolve({ url: 'http://127.0.0.1:' + server.address().port, close: () => server.close() }));
    });
}
module.exports = { start };
