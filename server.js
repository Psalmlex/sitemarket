require("dotenv").config();
const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const isProd = process.env.NODE_ENV === "production";

// Fail fast on missing/insecure config rather than booting with silent risk.
if (!process.env.DATABASE_URL) {
  console.error("FATAL: DATABASE_URL is not set.");
  process.exit(1);
}
if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET === "dev-secret-change-me")) {
  console.error("FATAL: JWT_SECRET must be set to a strong random value in production.");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com') ? { rejectUnauthorized: false } : false });

// Render and most PaaS providers sit behind a reverse proxy; this makes
// req.ip / rate limiting reflect the real client instead of the proxy.
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
  hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
}));
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: true, limit: "200kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: isProd ? "1d" : 0 }));

// Generous general limit, tighter limit on auth to blunt credential stuffing/brute force.
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts. Try again later." } });
// Blunts message/report spam and scraping without affecting normal browsing.
const writeLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests. Slow down and try again shortly." } });

function tokenFor(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: "7d", algorithm: "HS256" });
}

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "Authentication required" });
    // Pinning the algorithm defends against "alg confusion" attacks where a
    // token is crafted to force verification down an unintended path.
    const payload = jwt.verify(header.slice(7), JWT_SECRET, { algorithms: ["HS256"] });
    const { rows } = await pool.query("SELECT id,name,email,role,banned FROM users WHERE id=$1", [payload.id]);
    if (!rows[0]) return res.status(401).json({ error: "User not found" });
    if (rows[0].banned) return res.status(403).json({ error: "This account has been suspended" });
    req.user = rows[0];
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
}

function admin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}

app.get("/api/health", async (_, res) => {
  try { await pool.query("SELECT 1"); res.json({ ok: true }); }
  catch { res.status(500).json({ ok: false }); }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/.+/i;
// At least 8 chars, one letter and one number — blunts trivially-guessable
// passwords without the friction of full symbol-complexity rules.
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,200}$/;
// Fixed dummy hash so unknown-email logins take the same code path/timing
// as known-email logins (constant-time defense against user enumeration).
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing-parity", 12);
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const { name, email, password, role = "buyer" } = req.body;
  if (!name || typeof name !== "string" || !name.trim() || name.length > 120) return res.status(400).json({ error: "A valid name is required." });
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: "A valid email is required." });
  if (!password || !PASSWORD_RE.test(password)) return res.status(400).json({ error: "Password must be at least 8 characters and include a letter and a number." });
  if (!["buyer", "seller"].includes(role)) return res.status(400).json({ error: "Invalid role" });
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role",
      [name.trim(), email.toLowerCase().trim(), hash, role]
    );
    res.status(201).json({ user: rows[0], token: tokenFor(rows[0]) });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Email already registered" });
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [(email || "").toLowerCase().trim()]);
    const user = rows[0];
    // Run bcrypt.compare against a dummy hash even for unknown emails, so
    // response timing doesn't reveal whether an account exists.
    const hashToCheck = user ? user.password_hash : DUMMY_HASH;
    const validPassword = await bcrypt.compare(password || "", hashToCheck);

    if (user && user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(403).json({ error: `Too many failed attempts. Try again after ${new Date(user.locked_until).toLocaleTimeString()}.` });
    }
    if (!user || !validPassword) {
      if (user) {
        const attempts = user.failed_logins + 1;
        const lock = attempts >= MAX_FAILED_LOGINS;
        await pool.query(
          "UPDATE users SET failed_logins=$1, locked_until=$2 WHERE id=$3",
          [lock ? 0 : attempts, lock ? new Date(Date.now() + LOCKOUT_MINUTES*60*1000) : null, user.id]
        );
      }
      return res.status(401).json({ error: "Invalid email or password" });
    }
    if (user.banned) return res.status(403).json({ error: "This account has been suspended" });
    if (user.failed_logins > 0 || user.locked_until) {
      await pool.query("UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=$1", [user.id]);
    }
    const safe = { id: user.id, name: user.name, email: user.email, role: user.role };
    res.json({ user: safe, token: tokenFor(safe) });
  } catch { res.status(500).json({ error: "Login failed" }); }
});

app.get("/api/me", auth, (req, res) => res.json({ user: req.user }));

// Public, read-only subset of settings the storefront needs (niches for
// dropdowns, site name/support email for display). Never exposes anything
// sensitive — that's all under /api/admin/settings.
const PUBLIC_SETTING_KEYS = ["site_name", "support_email", "commission_rate", "niches"];
app.get("/api/settings", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT key,value FROM settings WHERE key = ANY($1)", [PUBLIC_SETTING_KEYS]);
    const out = {};
    for (const r of rows) out[r.key] = r.key === "niches" ? JSON.parse(r.value) : r.value;
    res.json({ settings: out });
  } catch { res.status(500).json({ error: "Could not load settings" }); }
});

app.get("/api/listings", async (req, res) => {
  const { q="", niche="", min="", max="", status="active" } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(48, Math.max(1, parseInt(req.query.pageSize, 10) || 24));
  const params = [];
  const where = [];
  if (status) { params.push(status); where.push(`l.status=$${params.length}`); }
  if (q) { params.push(`%${q}%`); where.push(`(l.title ILIKE $${params.length} OR l.description ILIKE $${params.length} OR l.url ILIKE $${params.length})`); }
  if (niche) { params.push(niche); where.push(`l.niche=$${params.length}`); }
  if (min && !Number.isNaN(Number(min))) { params.push(Number(min)); where.push(`l.asking_price >= $${params.length}`); }
  if (max && !Number.isNaN(Number(max))) { params.push(Number(max)); where.push(`l.asking_price <= $${params.length}`); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const countSql = `SELECT COUNT(*)::int count FROM listings l ${whereSql}`;
  params.push(pageSize, (page - 1) * pageSize);
  const sql = `SELECT l.*, u.name seller_name FROM listings l JOIN users u ON u.id=l.seller_id ${whereSql} ORDER BY l.featured DESC, l.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
  try {
    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(sql, params),
      pool.query(countSql, params.slice(0, params.length - 2)),
    ]);
    res.json({ listings: rows, total: countRows[0].count, page, pageSize });
  } catch { res.status(500).json({ error: "Could not load listings" }); }
});

app.get("/api/listings/:id", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT l.*,u.name seller_name FROM listings l JOIN users u ON u.id=l.seller_id WHERE l.id=$1 AND l.status='active'", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Listing not found" });
    res.json({ listing: rows[0] });
  } catch { res.status(500).json({ error: "Could not load listing" }); }
});

app.post("/api/listings", auth, async (req, res) => {
  if (!["seller","admin"].includes(req.user.role)) return res.status(403).json({ error: "Seller account required" });
  const { title, url, niche, description, asking_price, monthly_revenue=0, monthly_profit=0, monthly_visits=0, age_months=0 } = req.body;
  if (!title || !url || !niche || !description || !asking_price) return res.status(400).json({ error: "Title, URL, niche, description and asking price are required." });
  if (String(title).length > 180) return res.status(400).json({ error: "Title is too long." });
  if (!URL_RE.test(url)) return res.status(400).json({ error: "URL must start with http:// or https://" });
  if (Number(asking_price) <= 0 || Number(asking_price) > 1e9) return res.status(400).json({ error: "Enter a valid asking price." });
  // verification status is set by admin review, never trusted from the submitter.
  const verification = "unverified";
  try {
    const { rows: nicheRows } = await pool.query("SELECT value FROM settings WHERE key='niches'");
    const allowedNiches = nicheRows[0] ? JSON.parse(nicheRows[0].value) : null;
    if (allowedNiches && !allowedNiches.includes(niche)) return res.status(400).json({ error: "Invalid niche" });
    const { rows } = await pool.query(
      `INSERT INTO listings(seller_id,title,url,niche,description,asking_price,monthly_revenue,monthly_profit,monthly_visits,age_months,verification,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending') RETURNING *`,
      [req.user.id,title,url,niche,description,Number(asking_price),Number(monthly_revenue),Number(monthly_profit),Number(monthly_visits),Number(age_months),verification]
    );
    res.status(201).json({ listing: rows[0] });
  } catch { res.status(500).json({ error: "Could not create listing" }); }
});

app.get("/api/my/listings", auth, async (req,res) => {
  const { rows } = await pool.query("SELECT * FROM listings WHERE seller_id=$1 ORDER BY created_at DESC", [req.user.id]);
  res.json({ listings: rows });
});

app.post("/api/favorites/:listingId", auth, async (req,res) => {
  try {
    await pool.query("INSERT INTO favorites(user_id,listing_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [req.user.id, req.params.listingId]);
    res.json({ ok:true });
  } catch { res.status(500).json({ error:"Could not save listing" }); }
});

app.delete("/api/favorites/:listingId", auth, async (req,res) => {
  await pool.query("DELETE FROM favorites WHERE user_id=$1 AND listing_id=$2", [req.user.id, req.params.listingId]);
  res.json({ ok:true });
});

app.get("/api/favorites", auth, async (req,res) => {
  const { rows } = await pool.query(`SELECT l.* FROM favorites f JOIN listings l ON l.id=f.listing_id WHERE f.user_id=$1 ORDER BY f.created_at DESC`, [req.user.id]);
  res.json({ listings: rows });
});

app.post("/api/offers", auth, writeLimiter, async (req,res) => {
  const { listing_id, amount, message="" } = req.body;
  if (!listing_id) return res.status(400).json({ error:"listing_id is required" });
  if (!amount || Number(amount) <= 0 || Number(amount) > 1e9) return res.status(400).json({ error:"Valid offer amount required" });
  try {
    const { rows: listingRows } = await pool.query("SELECT id,seller_id,status FROM listings WHERE id=$1", [listing_id]);
    const target = listingRows[0];
    if (!target) return res.status(404).json({ error: "Listing not found" });
    if (target.seller_id === req.user.id) return res.status(400).json({ error: "You cannot make an offer on your own listing" });
    if (target.status !== "active") return res.status(400).json({ error: "This listing is not currently accepting offers" });
    const { rows } = await pool.query(
      "INSERT INTO offers(listing_id,buyer_id,amount,message,status) VALUES($1,$2,$3,$4,'pending') RETURNING *",
      [listing_id,req.user.id,Number(amount),String(message).slice(0,2000)]
    );
    res.status(201).json({ offer: rows[0] });
  } catch { res.status(500).json({ error:"Could not submit offer" }); }
});

app.get("/api/offers", auth, async (req,res) => {
  const { rows } = await pool.query(`
    SELECT o.*,l.title listing_title,u.name buyer_name
    FROM offers o JOIN listings l ON l.id=o.listing_id JOIN users u ON u.id=o.buyer_id
    WHERE o.buyer_id=$1 OR l.seller_id=$1 ORDER BY o.created_at DESC`, [req.user.id]);
  res.json({ offers: rows });
});

app.patch("/api/offers/:id", auth, async (req,res) => {
  const { status } = req.body;
  if (!["accepted","rejected","countered"].includes(status)) return res.status(400).json({error:"Invalid offer status"});
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT o.*,l.seller_id FROM offers o JOIN listings l ON l.id=o.listing_id WHERE o.id=$1 FOR UPDATE`, [req.params.id]);
    if (!rows[0] || rows[0].seller_id !== req.user.id) {
      await client.query("ROLLBACK");
      return res.status(403).json({error:"Not authorized"});
    }
    const result = await client.query("UPDATE offers SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *", [status,req.params.id]);
    // Accepting an offer closes the listing to further offers so buyers can't
    // keep bidding on a deal that's already agreed.
    if (status === "accepted") {
      await client.query("UPDATE listings SET status='sold',updated_at=NOW() WHERE id=$1", [rows[0].listing_id]);
    }
    await client.query("COMMIT");
    res.json({ offer: result.rows[0] });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Could not update offer" });
  } finally {
    client.release();
  }
});

app.post("/api/messages", auth, writeLimiter, async (req,res) => {
  const { listing_id, recipient_id, body } = req.body;
  if (!body?.trim() || body.length > 4000) return res.status(400).json({error:"Message required (max 4000 characters)"});
  if (!listing_id || !recipient_id) return res.status(400).json({error:"listing_id and recipient_id are required"});
  try {
    const { rows } = await pool.query(
      "INSERT INTO messages(listing_id,sender_id,recipient_id,body) VALUES($1,$2,$3,$4) RETURNING *",
      [listing_id,req.user.id,recipient_id,body.trim()]
    );
    res.status(201).json({message:rows[0]});
  } catch { res.status(500).json({ error: "Could not send message" }); }
});

app.get("/api/messages/:listingId", auth, async (req,res) => {
  const { rows } = await pool.query(
    "SELECT m.*,u.name sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.listing_id=$1 AND (m.sender_id=$2 OR m.recipient_id=$2) ORDER BY m.created_at ASC",
    [req.params.listingId,req.user.id]
  );
  res.json({messages:rows});
});

app.get("/api/admin/stats", auth, admin, async (_,res) => {
  const [users,listings,offers,reports] = await Promise.all([
    pool.query("SELECT COUNT(*)::int count FROM users"),
    pool.query("SELECT COUNT(*)::int count FROM listings"),
    pool.query("SELECT COUNT(*)::int count FROM offers"),
    pool.query("SELECT COUNT(*)::int count FROM reports WHERE status='open'")
  ]);
  res.json({users:users.rows[0].count,listings:listings.rows[0].count,offers:offers.rows[0].count,reports:reports.rows[0].count});
});

app.get("/api/admin/listings", auth, admin, async (_,res) => {
  const { rows } = await pool.query("SELECT l.*,u.name seller_name,u.email seller_email FROM listings l JOIN users u ON u.id=l.seller_id ORDER BY l.created_at DESC");
  res.json({listings:rows});
});

app.patch("/api/admin/listings/:id", auth, admin, async (req,res) => {
  const { status, verification, featured } = req.body;
  if (status && !["active","pending","rejected","sold"].includes(status)) return res.status(400).json({error:"Invalid status"});
  if (verification && !["unverified","partially_verified","verified"].includes(verification)) return res.status(400).json({error:"Invalid verification value"});
  const { rows } = await pool.query(
    "UPDATE listings SET status=COALESCE($1,status),verification=COALESCE($2,verification),featured=COALESCE($3,featured),updated_at=NOW() WHERE id=$4 RETURNING *",
    [status,verification,typeof featured==="boolean"?featured:null,req.params.id]
  );
  if (!rows[0]) return res.status(404).json({error:"Listing not found"});
  res.json({listing:rows[0]});
});

// ---- Admin: users ----
app.get("/api/admin/users", auth, admin, async (_,res) => {
  const { rows } = await pool.query(`
    SELECT u.id,u.name,u.email,u.role,u.banned,u.created_at,
      (SELECT COUNT(*)::int FROM listings l WHERE l.seller_id=u.id) listing_count,
      (SELECT COUNT(*)::int FROM offers o WHERE o.buyer_id=u.id) offer_count
    FROM users u ORDER BY u.created_at DESC`);
  res.json({ users: rows });
});

app.patch("/api/admin/users/:id", auth, admin, async (req,res) => {
  const targetId = Number(req.params.id);
  const { role, banned } = req.body;
  if (role && !["buyer","seller","admin"].includes(role)) return res.status(400).json({error:"Invalid role"});
  if (banned !== undefined && typeof banned !== "boolean") return res.status(400).json({error:"banned must be true or false"});
  if (targetId === req.user.id && (banned === true || role)) {
    return res.status(400).json({error:"You cannot change your own role or ban status"});
  }
  try {
    const { rows } = await pool.query(
      "UPDATE users SET role=COALESCE($1,role),banned=COALESCE($2,banned) WHERE id=$3 RETURNING id,name,email,role,banned,created_at",
      [role||null, typeof banned==="boolean"?banned:null, targetId]
    );
    if (!rows[0]) return res.status(404).json({error:"User not found"});
    res.json({ user: rows[0] });
  } catch { res.status(500).json({ error:"Could not update user" }); }
});

// ---- Admin: reports ----
app.get("/api/admin/reports", auth, admin, async (_,res) => {
  const { rows } = await pool.query(`
    SELECT r.*, l.title listing_title, u.name reporter_name
    FROM reports r JOIN listings l ON l.id=r.listing_id JOIN users u ON u.id=r.reporter_id
    ORDER BY r.status='open' DESC, r.created_at DESC`);
  res.json({ reports: rows });
});

app.patch("/api/admin/reports/:id", auth, admin, async (req,res) => {
  const { status } = req.body;
  if (!["open","resolved","dismissed"].includes(status)) return res.status(400).json({error:"Invalid status"});
  const { rows } = await pool.query(
    `UPDATE reports SET status=$1, resolved_by=CASE WHEN $1='open' THEN NULL ELSE $2 END,
     resolved_at=CASE WHEN $1='open' THEN NULL ELSE NOW() END WHERE id=$3 RETURNING *`,
    [status, req.user.id, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({error:"Report not found"});
  res.json({ report: rows[0] });
});

// ---- Admin: site settings ----
const SETTING_DEFS = {
  site_name: { max: 80 },
  support_email: { max: 255, pattern: EMAIL_RE },
  commission_rate: { max: 10, numeric: true, min: 0, maxVal: 100 },
  niches: { isJsonArray: true },
  require_verification_to_list: { oneOf: ["true","false"] },
};

app.get("/api/admin/settings", auth, admin, async (_,res) => {
  const { rows } = await pool.query("SELECT key,value,updated_at FROM settings ORDER BY key");
  const out = {};
  for (const r of rows) out[r.key] = { value: r.key === "niches" ? JSON.parse(r.value) : r.value, updated_at: r.updated_at };
  res.json({ settings: out });
});

app.patch("/api/admin/settings", auth, admin, async (req,res) => {
  const updates = req.body || {};
  const keys = Object.keys(updates).filter(k => SETTING_DEFS[k]);
  if (!keys.length) return res.status(400).json({ error: "No valid settings provided" });
  for (const k of keys) {
    const def = SETTING_DEFS[k];
    const v = updates[k];
    if (def.isJsonArray) {
      if (!Array.isArray(v) || !v.length || !v.every(x => typeof x === "string" && x.trim() && x.length <= 60)) {
        return res.status(400).json({ error: `${k} must be a non-empty array of short strings` });
      }
    } else if (def.oneOf) {
      if (!def.oneOf.includes(String(v))) return res.status(400).json({ error: `${k} must be one of ${def.oneOf.join(", ")}` });
    } else if (def.numeric) {
      const n = Number(v);
      if (Number.isNaN(n) || n < def.min || n > def.maxVal) return res.status(400).json({ error: `${k} must be a number between ${def.min} and ${def.maxVal}` });
    } else {
      if (typeof v !== "string" || !v.trim() || v.length > def.max) return res.status(400).json({ error: `${k} must be a non-empty string under ${def.max} characters` });
      if (def.pattern && !def.pattern.test(v)) return res.status(400).json({ error: `${k} is not valid` });
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const k of keys) {
      const raw = SETTING_DEFS[k].isJsonArray ? JSON.stringify(updates[k]) : String(updates[k]);
      await client.query(
        "INSERT INTO settings(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2,updated_at=NOW()",
        [k, raw]
      );
    }
    await client.query("COMMIT");
    const { rows } = await pool.query("SELECT key,value,updated_at FROM settings ORDER BY key");
    const out = {};
    for (const r of rows) out[r.key] = { value: r.key === "niches" ? JSON.parse(r.value) : r.value, updated_at: r.updated_at };
    res.json({ settings: out });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Could not update settings" });
  } finally {
    client.release();
  }
});

app.post("/api/reports", auth, writeLimiter, async (req,res) => {
  const { listing_id, reason, details="" } = req.body;
  if (!listing_id || !reason) return res.status(400).json({error:"listing_id and reason are required"});
  const exists = await pool.query("SELECT id FROM listings WHERE id=$1", [listing_id]);
  if (!exists.rows[0]) return res.status(404).json({error:"Listing not found"});
  const { rows } = await pool.query(
    "INSERT INTO reports(listing_id,reporter_id,reason,details) VALUES($1,$2,$3,$4) RETURNING *",
    [listing_id,req.user.id,reason,String(details).slice(0,2000)]
  );
  res.status(201).json({report:rows[0]});
});

app.get(/(.*)/, (req,res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({error:"Not found"});
  res.sendFile(path.join(__dirname,"public","index.html"));
});

// Catches anything an individual route handler didn't itself try/catch,
// including malformed JSON bodies from express.json().
app.use((err, req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: isProd ? "Something went wrong" : err.message });
});

const server = app.listen(PORT, () => console.log(`SiteMarket running on port ${PORT}`));

function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
