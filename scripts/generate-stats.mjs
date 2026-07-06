// Generates synthwave-styled stats cards (stats.svg, langs.svg, streak.svg)
// from the GitHub GraphQL API. Runs in CI with the default GITHUB_TOKEN;
// no dependencies beyond Node 18+ (global fetch).
//
// Usage: GITHUB_TOKEN=... USER=avipami OUT=dist node scripts/generate-stats.mjs

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TOKEN = process.env.GITHUB_TOKEN;
const USER = process.env.USER_LOGIN || process.env.USER || "avipami";
const OUT = process.env.OUT || "dist";

if (!TOKEN) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

// ---------- palette (matches assets/dogfight.svg) ----------
const C = {
  bgTop: "#0a0620",
  bgBottom: "#1c0f38",
  border: "#ff2d95",
  title: "#ff2d95",
  text: "#e6edf3",
  accent: "#7df9ff",
  dim: "#8b93b8",
  grid: "#ff2d95",
};
const FONT = "'Segoe UI', -apple-system, Ubuntu, Helvetica, sans-serif";

// ---------- GraphQL ----------
async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-stats-generator",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error("GraphQL errors: " + JSON.stringify(json.errors));
  return json.data;
}

const baseData = await gql(
  `query ($login: String!) {
    user(login: $login) {
      createdAt
      followers { totalCount }
      repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
        totalCount
        nodes {
          stargazerCount
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name color } }
          }
        }
      }
      contributionsCollection {
        totalCommitContributions
        totalPullRequestContributions
        totalIssueContributions
        totalPullRequestReviewContributions
        restrictedContributionsCount
        contributionCalendar { totalContributions }
      }
    }
  }`,
  { login: USER }
);
const user = baseData.user;

// One aliased calendar query per account year, capped at 1-year ranges.
const firstYear = new Date(user.createdAt).getUTCFullYear();
const nowYear = new Date().getUTCFullYear();
const aliases = [];
for (let y = firstYear; y <= nowYear; y++) {
  aliases.push(
    `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") {
       contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
     }`
  );
}
const calData = await gql(
  `query ($login: String!) { user(login: $login) { ${aliases.join("\n")} } }`,
  { login: USER }
);

const today = new Date().toISOString().slice(0, 10);
const days = [];
let totalAllTime = 0;
for (let y = firstYear; y <= nowYear; y++) {
  const cal = calData.user[`y${y}`].contributionCalendar;
  totalAllTime += cal.totalContributions;
  for (const w of cal.weeks)
    for (const d of w.contributionDays)
      if (d.date <= today) days.push(d);
}
days.sort((a, b) => a.date.localeCompare(b.date));

// ---------- streaks ----------
let longest = { len: 0, start: null, end: null };
let run = { len: 0, start: null, end: null };
for (const d of days) {
  if (d.contributionCount > 0) {
    if (run.len === 0) run.start = d.date;
    run.len++;
    run.end = d.date;
    if (run.len > longest.len) longest = { ...run };
  } else if (d.date !== today) {
    run = { len: 0, start: null, end: null };
  }
}
const current = run; // ongoing run (a zero today doesn't break it yet)

// ---------- aggregates ----------
const stars = user.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);
const cc = user.contributionsCollection;
const langTotals = new Map();
for (const repo of user.repositories.nodes)
  for (const e of repo.languages.edges) {
    const cur = langTotals.get(e.node.name) || { size: 0, color: e.node.color || "#8b93b8" };
    cur.size += e.size;
    langTotals.set(e.node.name, cur);
  }
const langSum = [...langTotals.values()].reduce((s, l) => s + l.size, 0) || 1;
const topLangs = [...langTotals.entries()]
  .map(([name, v]) => ({ name, color: v.color, pct: (v.size / langSum) * 100 }))
  .sort((a, b) => b.pct - a.pct)
  .slice(0, 6);

// ---------- svg helpers ----------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const num = (n) => n.toLocaleString("en-US");
const fmt = (iso) =>
  iso
    ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    : "—";

function card(w, h, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.bgTop}"/><stop offset="1" stop-color="${C.bgBottom}"/>
    </linearGradient>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="2.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="8" fill="url(#bg)" stroke="${C.border}" stroke-opacity="0.45"/>
  <g stroke="${C.grid}" stroke-opacity="0.10">
    <line x1="0" y1="${h - 18}" x2="${w}" y2="${h - 18}"/>
    <line x1="0" y1="${h - 9}" x2="${w}" y2="${h - 9}"/>
  </g>
  <text x="20" y="30" font-family="${FONT}" font-size="16" font-weight="700" fill="${C.title}" filter="url(#glow)">${esc(title)}</text>
  ${body}
</svg>`;
}

// NOTE: no entrance animations — some renderers rasterize SVG-in-<img> at t=0,
// so all content must be fully visible statically. Only infinite loops allowed.

// ---------- card 1: stats ----------
function statsCard() {
  const commits = cc.totalCommitContributions + cc.restrictedContributionsCount;
  const rows = [
    ["Commits (past year)", num(commits)],
    ["Total Stars", num(stars)],
    ["Public Repos", num(user.repositories.totalCount)],
    ["Pull Requests", num(cc.totalPullRequestContributions)],
    ["Followers", num(user.followers.totalCount)],
  ];
  const rowSvg = rows
    .map(
      ([label, value], i) => `<g font-family="${FONT}" font-size="13.5">
      <circle cx="26" cy="${56 + i * 21 - 4}" r="2.5" fill="${C.accent}"/>
      <text x="38" y="${56 + i * 21}" fill="${C.text}">${esc(label)}</text>
      <text x="222" y="${56 + i * 21}" fill="${C.accent}" font-weight="700">${esc(value)}</text>
    </g>`
    )
    .join("\n");
  const ring = `<g transform="translate(338 100)">
    <circle r="42" fill="none" stroke="${C.border}" stroke-opacity="0.25" stroke-width="8"/>
    <circle r="42" fill="none" stroke="${C.border}" stroke-width="4" filter="url(#glow)">
      <animate attributeName="stroke-opacity" values="1;0.45;1" dur="2.4s" repeatCount="indefinite"/>
    </circle>
    <text y="-2" text-anchor="middle" font-family="${FONT}" font-size="19" font-weight="800" fill="${C.text}">${num(cc.contributionCalendar.totalContributions)}</text>
    <text y="16" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${C.dim}">contributions</text>
    <text y="28" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${C.dim}">past year</text>
  </g>`;
  return card(420, 165, `⚡ ${USER === "avipami" ? "Vinnie" : USER}'s GitHub Stats`, rowSvg + ring);
}

// ---------- card 2: top languages ----------
function langsCard() {
  const barX = 20, barW = 300, barY = 46, barH = 10;
  let x = 0;
  const segs = topLangs
    .map((l) => {
      const w = (l.pct / 100) * barW;
      const seg = `<rect x="${(barX + x).toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="${barH}" fill="${l.color}"/>`;
      x += w;
      return seg;
    })
    .join("");
  const legend = topLangs
    .map((l, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const lx = 20 + col * 155, ly = 82 + row * 22;
      return `<g font-family="${FONT}" font-size="12.5">
        <circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${l.color}"/>
        <text x="${lx + 17}" y="${ly}" fill="${C.text}">${esc(l.name)}</text>
        <text x="${lx + 17 + Math.min(l.name.length, 14) * 7 + 8}" y="${ly}" fill="${C.dim}">${l.pct.toFixed(1)}%</text>
      </g>`;
    })
    .join("\n");
  const bar = `<clipPath id="barclip"><rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="5"/></clipPath>
    <rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="5" fill="#241a45"/>
    <g clip-path="url(#barclip)">${segs}
      <rect x="${barX - 40}" y="${barY}" width="30" height="${barH}" fill="#ffffff" opacity="0.35">
        <animateTransform attributeName="transform" type="translate" from="0 0" to="${barW + 80} 0" dur="3s" repeatCount="indefinite"/>
      </rect>
    </g>`;
  return card(340, 165, "🚀 Most Used Languages", bar + legend);
}

// ---------- card 3: streak ----------
function streakCard() {
  const col = (cx, big, bigColor, label, sub, i, ring) => `<g font-family="${FONT}" text-anchor="middle">
    ${ring || ""}
    <text x="${cx}" y="96" font-size="26" font-weight="800" fill="${bigColor}" ${ring ? 'filter="url(#glow)"' : ""}>${esc(big)}</text>
    <text x="${cx}" y="124" font-size="13" font-weight="700" fill="${C.text}">${esc(label)}</text>
    <text x="${cx}" y="144" font-size="11" fill="${C.dim}">${esc(sub)}</text>
  </g>`;
  const ring = `<circle cx="247" cy="88" r="40" fill="none" stroke="${C.border}" stroke-width="4" stroke-opacity="0.9" filter="url(#glow)">
      <animate attributeName="stroke-opacity" values="0.9;0.4;0.9" dur="2.4s" repeatCount="indefinite"/>
    </circle>`;
  const body =
    col(82, num(totalAllTime), C.accent, "Total Contributions", `${fmt(days.find((d) => d.contributionCount > 0)?.date)} — Present`, 0) +
    col(247, `${current.len} 🔥`, C.text, "Current Streak", current.len ? `${fmt(current.start)} — ${fmt(current.end)}` : "start one today!", 1, ring) +
    col(412, num(longest.len), C.accent, "Longest Streak", longest.len ? `${fmt(longest.start)} — ${fmt(longest.end)}` : "—", 2) +
    `<g stroke="${C.border}" stroke-opacity="0.25"><line x1="165" y1="52" x2="165" y2="150"/><line x1="330" y1="52" x2="330" y2="150"/></g>`;
  return card(495, 172, "🎹 Contribution Streak", body);
}

// ---------- write ----------
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "stats.svg"), statsCard());
await writeFile(join(OUT, "langs.svg"), langsCard());
await writeFile(join(OUT, "streak.svg"), streakCard());
console.log(
  `Generated stats.svg, langs.svg, streak.svg in ${OUT}/ — ` +
    `${num(totalAllTime)} contributions, current streak ${current.len}, longest ${longest.len}, ${topLangs.length} languages`
);
