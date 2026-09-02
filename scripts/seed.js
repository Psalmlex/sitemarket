const {Pool}=require("pg");
const bcrypt=require("bcryptjs");
require("dotenv").config();
(async()=>{
 const pool=new Pool({connectionString:process.env.DATABASE_URL, ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com') ? { rejectUnauthorized: false } : false});
 const passwords={admin:await bcrypt.hash(process.env.ADMIN_PASSWORD||"Admin123!",12),seller:await bcrypt.hash("Seller123!",12),buyer:await bcrypt.hash("Buyer123!",12)};
 await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin') ON CONFLICT(email) DO NOTHING",["Admin","admin@sitemarket.local",passwords.admin]);
 await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'seller') ON CONFLICT(email) DO NOTHING",["Demo Seller","seller@sitemarket.local",passwords.seller]);
 await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'buyer') ON CONFLICT(email) DO NOTHING",["Demo Buyer","buyer@sitemarket.local",passwords.buyer]);
 const s=await pool.query("SELECT id FROM users WHERE email='seller@sitemarket.local'");
 await pool.query(`INSERT INTO listings(seller_id,title,url,niche,description,asking_price,monthly_revenue,monthly_profit,monthly_visits,age_months,verification,status,featured)
 VALUES($1,'Niche Finance Blog','https://example.com','Finance','A content site with evergreen articles, organic traffic potential and a clean brand. Replace this demo listing with real verified data.',3500,650,420,18500,24,'partially_verified','active',true)
 ON CONFLICT DO NOTHING`,[s.rows[0].id]);
 await pool.end(); console.log("Demo data seeded.");
})().catch(e=>{console.error(e);process.exit(1)});
