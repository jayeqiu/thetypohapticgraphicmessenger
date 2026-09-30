const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8'
};

const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    if (requestUrl.pathname === '/api/svgs') {
        fs.readdir(path.join(root, 'svg'), { withFileTypes: true }, (error, entries) => {
            if (error) {
                response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                response.end(JSON.stringify({ error: 'Could not read the svg directory.' }));
                return;
            }
            const files = entries
                .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.svg'))
                .map(entry => entry.name)
                .sort((a, b) => a.localeCompare(b));
            response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify(files));
        });
        return;
    }

    let pathname;
    try {
        pathname = decodeURIComponent(requestUrl.pathname);
    } catch {
        response.writeHead(400);
        response.end('Bad request');
        return;
    }
    if (pathname === '/') pathname = '/index.html';

    const filePath = path.resolve(root, `.${pathname}`);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            response.writeHead(error.code === 'ENOENT' ? 404 : 500);
            response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
            return;
        }
        response.writeHead(200, {
            'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
        });
        response.end(content);
    });
});

server.listen(port, '127.0.0.1', () => {
    console.log(`Shape display available at http://127.0.0.1:${port}`);
});