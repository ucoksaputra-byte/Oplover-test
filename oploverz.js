const mangayomiSources = [{
  "name": "Oploverz",
  "lang": "id",
  "baseUrl": "https://oploverz.diy",
  "apiUrl": "",
  "iconUrl": "https://oploverz.diy/logo.png",
  "typeSource": "single",
  "isManga": false,
  "itemType": 1,
  "version": "0.0.1",
  "pkgPath": "anime/src/id/oploverz.js"
}];

const UA = "Mozilla/5.0 (Linux; Android 13; Mobile; rv:159.0) Gecko/159.0 Firefox/159.0";

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
    return { "Referer": this.source.baseUrl + "/", "User-Agent": UA };
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
      const name = img ? (img.attr("alt") || "").trim() : "";
      if (!name) continue;
      seen[link] = true;
      list.push({ name: name, link: link, imageUrl: img.attr("src") || "" });
    }
    return { list: list, hasNextPage: false };
  }

  async getPopular(page) { return this.listFrom(this.source.baseUrl + "/series", false); }
  async getLatestUpdates(page) { return this.listFrom(this.source.baseUrl, true); }

  async search(query, page, filters) {
    const all = await this.listFrom(this.source.baseUrl + "/series", false);
    const q = query.toLowerCase();
    return { list: all.list.filter(x => x.name.toLowerCase().includes(q)), hasNextPage: false };
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
      const ds = doc.selectFirst('meta[name="description"]');
      if (ds) description = ds.attr("content");
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

  // ---- Ambil m3u8 dari embed upbolt ----
  async resolveUpbolt(embedUrl) {
    const code = embedUrl.split("/").pop();
    const res = await new Client().post("https://upbolt.to/dl",
      { "Referer": embedUrl, "Origin": "https://upbolt.to", "User-Agent": UA },
      { op: "embed", file_code: code, auto: "1", referer: this.source.baseUrl + "/" });
    const m = res.body.match(/https:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/);
    return m ? m[0].replace(/&amp;/g, "&") : null;
  }

  async getVideoList(url) {
    const res = await new Client().get(url.replace(/\/$/, "") + "/__data.json", this.getHeaders());
    const json = JSON.parse(res.body);
    const streams = [];
    const seen = new Set();
    for (const n of json.nodes) {
      if (n && n.type === "data" && n.data) findStreams(unflatten(n.data), streams, seen);
    }
    const videos = [];
    for (const s of streams) {
      const m3u8 = await this.resolveUpbolt(s.url);
      if (!m3u8) continue;
      videos.push({
        url: m3u8, originalUrl: m3u8, quality: "Upbolt " + s.label,
        headers: { "Referer": "https://upbolt.to/", "Origin": "https://upbolt.to", "User-Agent": UA }
      });
    }
    return videos;
  }

  getFilterList() { return []; }
  getSourcePreferences() { return []; }
}
