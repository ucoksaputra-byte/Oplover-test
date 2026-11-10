const mangayomiSources = [{
  "name": "Oploverz",
  "lang": "id",
  "baseUrl": "https://oploverz.diy",
  "apiUrl": "",
  "iconUrl": "https://oploverz.diy/logo.png",
  "typeSource": "single",
  "isManga": false,
  "itemType": 1,
  "version": "0.0.5",
  "pkgPath": "anime/src/id/oploverz.js"
}];

// ---- Pembongkar format "devalue" milik SvelteKit (__data.json) ----
function unflatten(data) {
  const cache = {};
  function h(i) {
    if (i < 0) return undefined;
    if (i in cache) return cache[i];
    const v = data[i];
    if (v === null || typeof v !== "object") return (cache[i] = v);
    if (Array.isArray(v)) {
      if (typeof v[0] === "string") return (cache[i] = v[1]); // tipe khusus (Date, dll)
      const arr = [];
      cache[i] = arr;
      for (const x of v) arr.push(h(x));
      return arr;
    }
    const obj = {};
    cache[i] = obj;
    for (const k in v) obj[k] = h(v[k]);
    return obj;
  }
  return h(0);
}

// Cari objek {source:"Nonton Online 720p", url:"https://upbolt.to/e/xxxx"} di mana pun
function findStreams(node, out, seen) {
  if (!node || typeof node !== "object" || seen.has(node)) return out;
  seen.add(node);
  if (typeof node.url === "string" && typeof node.source === "string" &&
      node.url.includes("upbolt.to/e/")) {
    out.push({ label: node.source.replace("Nonton Online", "").trim(), url: node.url });
  }
  for (const k in node) findStreams(node[k], out, seen);
  return out;
}

class DefaultExtension extends MProvider {
  getHeaders() {
    return { "Referer": this.source.baseUrl + "/" };
  }

  abs(href) {
    if (!href) return "";
    if (href.startsWith("http")) return href;
    return this.source.baseUrl + (href.startsWith("/") ? "" : "/") + href;
  }

  // ---- Daftar anime (HTML). Selector masih tebakan, cek hasilnya di app ----
  async listFrom(url, fromEpisodes) {
    const res = await new Client().get(url, this.getHeaders());
    const doc = new Document(res.body);
    const seen = {};
    const list = [];
    for (const a of doc.select('a[href*="/series/"]')) {
      let link = this.abs(a.getHref);
      const isEp = link.includes("/episode/");
      if (isEp && !fromEpisodes) continue;
      if (isEp) link = link.split("/episode/")[0];
      const slug = link.split("/series/")[1];
      if (!slug || seen[link]) continue;
      const img = a.selectFirst("img");
      let name = img ? (img.attr("alt") || "").trim() : "";
      if (!name) {
        name = slug.replace(/\/$/, "").split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      }
      const imageUrl = img ? (img.attr("src") || img.attr("data-src") || "") : "";
      seen[link] = true;
      list.push({ name: name, link: link, imageUrl: imageUrl });
    }
    return { list: list, hasNextPage: false };
  }

  async getPopular(page) {
    const r = await this.listFrom(this.source.baseUrl + "/series", false);
    if (r.list.length > 0) return r;
    return this.listFrom(this.source.baseUrl, false);
  }
  async getLatestUpdates(page) { return this.listFrom(this.source.baseUrl, true); }

  async search(query, page, filters) {
    const a = await this.listFrom(this.source.baseUrl + "/series", false);
    const b = await this.listFrom(this.source.baseUrl, true);
    const q = query.toLowerCase();
    const seen = {};
    const out = [];
    for (const x of a.list.concat(b.list)) {
      if (seen[x.link] || !x.name.toLowerCase().includes(q)) continue;
      seen[x.link] = true;
      out.push(x);
    }
    return { list: out, hasNextPage: false };
  }

  // ---- Detail + daftar episode ----
  async getDetail(url) {
    const res = await new Client().get(url, this.getHeaders());
    const doc = new Document(res.body);
    const h1 = doc.selectFirst("h1");
    const name = h1 ? h1.text.trim() : "";
    let imageUrl = "";
    let description = "";
    try {
      const og = doc.selectFirst('meta[property="og:image"]');
      if (og) imageUrl = og.attr("content");
      const dsAll = doc.select('meta[name="description"]');
      if (dsAll.length > 0) description = dsAll[dsAll.length - 1].attr("content");
    } catch (e) {}
    const seen = {};
    const episodes = [];
    for (const a of doc.select('a[href*="/episode/"]')) {
      const link = this.abs(a.getHref);
      if (seen[link]) continue;
      seen[link] = true;
      episodes.push({ name: "Episode " + link.split("/").pop(), url: link });
    }
    const num = e => parseFloat(e.url.split("/").pop()) || 0;
    episodes.sort((a, b) => num(b) - num(a));
    return { name: name, imageUrl: imageUrl, description: description,
             link: url, status: 5, genre: [], episodes: episodes };
  }

  // ---- Ambil m3u8 dari embed upbolt (meniru urutan browser: GET /e/kode lalu POST /dl) ----
  parseCookies(h) {
    const raw = h && (h["set-cookie"] || h["Set-Cookie"]);
    if (!raw) return "";
    return String(raw).split(/,(?=\s*[^;,=\s]+=)/)
      .map(x => x.split(";")[0].trim()).filter(x => x.indexOf("=") > 0).join("; ");
  }

  async resolveUpbolt(embedUrl) {
    const code = embedUrl.split("/").pop();
    const client = new Client();
    const accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    const page = await client.get(embedUrl, { "Referer": this.source.baseUrl + "/", "Accept": accept });
    if (page.statusCode && page.statusCode !== 200) {
      throw new Error("upbolt /e/ HTTP " + page.statusCode);
    }
    const headers = { "Referer": embedUrl, "Origin": "https://upbolt.to", "Accept": accept };
    const cookie = this.parseCookies(page.headers);
    if (cookie) headers["Cookie"] = cookie;
    const res = await client.post("https://upbolt.to/dl", headers,
      { op: "embed", file_code: code, auto: "1", referer: this.source.baseUrl + "/" });
    if (res.statusCode && res.statusCode !== 200) {
      throw new Error("upbolt /dl HTTP " + res.statusCode);
    }
    const m = res.body.match(/https:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/);
    if (!m) throw new Error("m3u8 tidak ada di respons /dl (panjang " + res.body.length + ")");
    return m[0].replace(/&amp;/g, "&");
  }

  async getVideoList(url) {
    const res = await new Client().get(url.replace(/\/$/, "") + "/__data.json", this.getHeaders());
    if (res.statusCode && res.statusCode !== 200) throw new Error("oploverz __data.json HTTP " + res.statusCode);
    const json = JSON.parse(res.body);
    const streams = [];
    const seen = new Set();
    for (const n of json.nodes) {
      if (n && n.type === "data" && n.data) findStreams(unflatten(n.data), streams, seen);
    }
    if (streams.length === 0) throw new Error("Tidak ada embed upbolt di __data.json");
    const errors = [];
    const results = await Promise.all(streams.map(async s => {
      try {
        const m3u8 = await this.resolveUpbolt(s.url);
        return {
          url: m3u8, originalUrl: m3u8, quality: "Upbolt " + s.label,
          headers: { "Referer": "https://upbolt.to/", "Origin": "https://upbolt.to" }
        };
      } catch (e) { errors.push(String(e && e.message ? e.message : e)); return null; }
    }));
    const videos = results.filter(v => v);
    if (videos.length === 0) throw new Error(errors[0] || "Video kosong");
    return videos;
  }

  getFilterList() { return []; }
  getSourcePreferences() { return []; }
}
