const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config();

(async()=>{
  const pool = new Pool({connectionString:process.env.DATABASE_URL, ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com') ? { rejectUnauthorized: false } : false});
  const sql = fs.readFileSync(path.join(__dirname,"..","db","schema.sql"),"utf8");
  await pool.query(sql);
  await pool.end();
  console.log("Database initialized.");
})().catch(e=>{console.error(e);process.exit(1)});
