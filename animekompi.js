const mangayomiSources = [{
  "name": "Animekompi",
  "lang": "id",
  "baseUrl": "https://v11.animekompi.sbs",
  "apiUrl": "",
  "iconUrl": "https://v11.animekompi.sbs/animekompi-logo.png",
  "typeSource": "single",
  "isManga": false,
  "itemType": 1,
  "version": "0.0.2",
  "pkgPath": "anime/src/id/animekompi.js"
}];

class DefaultExtension extends MProvider {
  getHeaders() {
    return { "Referer": this.source.baseUrl + "/", "Accept": "application/json" };
  }

  img(p) {
    if (!p) return "";
    return p.startsWith("http") ? p : this.source.baseUrl + p;
  }

  async fetchJson(url) {
    const res = await new Client().get(url, this.getHeaders());
    if (res.statusCode && res.statusCode !== 200) {
      throw new Error("HTTP " + res.statusCode + " dari " + url);
    }
    return JSON.parse(res.body);
  }

  // ---- Daftar episode terbaru -> satu entri per anime ----
  async latestPage(page) {
    const base = this.source.baseUrl;
    const j = await this.fetchJson(base + "/api/episodes/latest?page=" + page + "&limit=15&feed=anime");
    const seen = {};
    const list = [];
    for (const e of j.data) {
      if (seen[e.animeSlug]) continue;
      seen[e.animeSlug] = true;
      list.push({
        name: e.animeTitle,
        imageUrl: this.img(e.cover),
        link: base + "/anime/" + e.animeSlug
      });
    }
    return { list: list, hasNextPage: j.page < j.totalPages };
  }

  // ---- Daftar anime dari /api/anime ----
  animeList(j) {
    const base = this.source.baseUrl;
    const list = (j.data || []).map(a => ({
      name: a.title,
      imageUrl: this.img(a.cover),
      link: base + "/anime/" + a.slug
    }));
    return { list: list, hasNextPage: (j.page || 1) < (j.totalPages || 1) };
  }

  async getLatestUpdates(page) { return this.latestPage(page); }

  // /api/anime tanpa q diasumsikan mengembalikan seluruh daftar; kalau gagal, pakai Latest
  async getPopular(page) {
    try {
      const j = await this.fetchJson(this.source.baseUrl + "/api/anime?page=" + page);
      if (j.data && j.data.length) return this.animeList(j);
    } catch (e) {}
    return this.latestPage(page);
  }

  async search(query, page, filters) {
    const j = await this.fetchJson(this.source.baseUrl + "/api/anime?q=" + encodeURIComponent(query) + "&page=" + page);
    return this.animeList(j);
  }

  // Cari array objek yang punya "episodeNumber" di mana pun dalam JSON
  findEpisodes(node) {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node) && node.length && node[0] && typeof node[0] === "object" &&
        node[0].episodeNumber !== undefined) return node;
    for (const k in node) {
      const r = this.findEpisodes(node[k]);
      if (r) return r;
    }
    return null;
  }

  // ---- Detail: alamat /api/anime/{slug} masih TEBAKAN ----
  async getDetail(url) {
    const base = this.source.baseUrl;
    const slug = url.replace(/\/$/, "").split("/").pop();
    const j = await this.fetchJson(base + "/api/anime/" + encodeURIComponent(slug));
    const root = (j.data && typeof j.data === "object" && !Array.isArray(j.data)) ? j.data : j;
    if (!root.title) {
      throw new Error("Detail: field title tidak ada. Kunci: " + Object.keys(root).join(","));
    }
    const eps = this.findEpisodes(j);
    if (!eps) {
      throw new Error("Detail ok, tapi daftar episode tidak ketemu. Kunci: " + Object.keys(root).join(","));
    }
    const statusMap = { ongoing: 0, completed: 1, hiatus: 2 };
    const episodes = eps.map(e => {
      const ep = { name: "Episode " + e.episodeNumber, url: base + "/api/episodes/" + e.slug };
      const d = e.releasedAt || e.createdAt;
      if (d) {
        const t = new Date(String(d).substring(0, 19).replace(" ", "T") + "Z").getTime();
        if (!isNaN(t)) ep.dateUpload = String(t);
      }
      return ep;
    });
    episodes.sort((a, b) => parseFloat(b.name.split(" ")[1]) - parseFloat(a.name.split(" ")[1]));
    return {
      name: root.title,
      imageUrl: this.img(root.cover),
      description: root.synopsis || "",
      author: root.studio || "",
      genre: (root.genres || []).map(g => g.name),
      status: statusMap[root.status] !== undefined ? statusMap[root.status] : 5,
      link: url,
      episodes: episodes
    };
  }

  async getVideoList(url) {
    throw new Error("getVideoList belum dibuat: butuh API episode (" + url + ")");
  }

  getFilterList() { return []; }
  getSourcePreferences() { return []; }
}
