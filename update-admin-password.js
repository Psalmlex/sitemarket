const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const newPassword = process.argv[2];
const hash = bcrypt.hashSync(newPassword, 12);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.query("UPDATE users SET password_hash=$1 WHERE email='admin@sitemarket.local'", [hash])
  .then(() => { console.log('Password updated.'); pool.end(); })
  .catch(e => { console.error(e); pool.end(); });
