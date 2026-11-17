// HermoPDF site Worker: static site (ASSETS) + installer download from R2 (/download/<dosya>.exe).
// www -> apex yönlendirmesi. Gizli bilgi yok.
const DOWNLOAD_RE = /^\/download\/(HermoPDF-Setup-[0-9A-Za-z.\-]+\.exe)$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'www.hermopdf.com') {
      url.hostname = 'hermopdf.com';
      return Response.redirect(url.toString(), 301);
    }
    const m = DOWNLOAD_RE.exec(url.pathname);
    if (m && (request.method === 'GET' || request.method === 'HEAD')) {
      const key = m[1];
      const obj = request.method === 'HEAD'
        ? await env.DOWNLOADS.head(key)
        : await env.DOWNLOADS.get(key, { range: request.headers });
      if (!obj) return new Response('Not found', { status: 404 });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      headers.set('accept-ranges', 'bytes');
      headers.set('content-disposition', `attachment; filename="${key}"`);
      headers.set('x-content-type-options', 'nosniff');
      headers.set('cache-control', 'public, max-age=3600');
      let status = 200;
      if (obj.range && request.method === 'GET') {
        status = 206;
        const { offset = 0, length = obj.size - offset } = obj.range;
        headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
        headers.set('content-length', String(length));
      } else {
        headers.set('content-length', String(obj.size));
      }
      return new Response(request.method === 'HEAD' ? null : obj.body, { status, headers });
    }
    return env.ASSETS.fetch(request);
  },
};
