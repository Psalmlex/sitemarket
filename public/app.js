const app=document.getElementById("app"), nav=document.getElementById("navActions");
const state={token:localStorage.getItem("sm_token"),user:JSON.parse(localStorage.getItem("sm_user")||"null")};
const money=n=>"$"+Number(n||0).toLocaleString();
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let siteSettings=null;
async function getSiteSettings(){if(siteSettings)return siteSettings;try{const d=await api("/settings");siteSettings=d.settings}catch{siteSettings={site_name:"SiteMarket",niches:["Finance","Health","SaaS","Ecommerce","Education","Content","Other"]}}return siteSettings}
function nicheOptions(selected){return (siteSettings?.niches||[]).map(n=>`<option ${n===selected?"selected":""}>${esc(n)}</option>`).join("")}
async function api(url,opt={}){opt.headers={...(opt.headers||{}), "Content-Type":"application/json"};if(state.token)opt.headers.Authorization="Bearer "+state.token;const r=await fetch("/api"+url,opt);const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"Request failed");return d}
function toast(t){const e=document.createElement("div");e.className="toast";e.textContent=t;document.body.appendChild(e);setTimeout(()=>e.remove(),2500)}
function setSession(d){state.token=d.token;state.user=d.user;localStorage.setItem("sm_token",d.token);localStorage.setItem("sm_user",JSON.stringify(d.user));renderNav()}
function logout(){localStorage.clear();state.token=null;state.user=null;location.hash="#/"}
function renderNav(){nav.innerHTML=state.user?`<a class="btn alt" href="#/dashboard">${state.user.name}</a><button class="btn dark" onclick="logout()">Log out</button>`:`<a class="btn alt" href="#/login">Log in</a><a class="btn" href="#/register">Join</a>`}
renderNav();

async function home(){app.innerHTML=`<section class="hero"><div class="container"><h1>Buy a website. Sell a website. Build your next business.</h1><p>A focused marketplace for websites and digital businesses, with transparent listing data and verification signals.</p><div class="actions"><a class="btn" href="#/marketplace">Explore websites</a><a class="btn alt" href="#/sell">Sell your website</a></div></div></section><div class="container"><div class="trust"><div class="card"><h3>Clear metrics</h3><p class="muted">Revenue, profit, traffic, age and asking price are presented in one place.</p></div><div class="card"><h3>Verification signals</h3><p class="muted">Listings can show verified, partially verified or unverified data.</p></div><div class="card"><h3>Direct offers</h3><p class="muted">Buyers can save listings, message sellers and submit offers.</p></div></div><div class="sectionhead"><div><h2>Featured opportunities</h2><p class="muted">Browse the latest active listings.</p></div><a class="btn alt" href="#/marketplace">View all</a></div><div id="featured" class="grid"></div></div>`;const d=await api("/listings");renderListings(d.listings.slice(0,6),"featured")}
function renderListings(items,id="results"){const el=document.getElementById(id);if(!items.length){el.innerHTML=`<div class="card empty">No listings found.</div>`;return}el.innerHTML=items.map(l=>`<article class="card listing"><div class="cover"><small>${esc(l.niche)}</small><h3>${esc(l.title)}</h3></div><span class="badge">${esc(l.verification.replace("_"," "))}</span>${l.featured?` <span class="badge" style="background:#fef3c7;color:#92400e">featured</span>`:""}<p class="muted">${esc((l.description||"").slice(0,105))}...</p><div class="metrics"><div class="metric"><small>Revenue</small><strong>${money(l.monthly_revenue)}/mo</strong></div><div class="metric"><small>Visits</small><strong>${Number(l.monthly_visits).toLocaleString()}</strong></div><div class="metric"><small>Age</small><strong>${l.age_months} mo</strong></div></div><div style="display:flex;justify-content:space-between;align-items:center"><span class="price">${money(l.asking_price)}</span><a class="btn" href="#/listing/${l.id}">View deal</a></div></article>`).join("")}
async function marketplace(){await getSiteSettings();app.innerHTML=`<div class="container"><div class="sectionhead"><div><h2>Marketplace</h2><p class="muted">Find websites by niche, price and opportunity.</p></div></div><div class="toolbar"><input id="q" placeholder="Search websites..."><select id="niche"><option value="">All niches</option>${nicheOptions()}</select><input id="min" type="number" placeholder="Min price"><input id="max" type="number" placeholder="Max price"><button onclick="loadMarket()">Search</button></div><div id="results" class="grid"></div></div>`;await loadMarket()}
async function loadMarket(){const q=document.getElementById("q").value,n=document.getElementById("niche").value,min=document.getElementById("min").value,max=document.getElementById("max").value;const d=await api(`/listings?q=${encodeURIComponent(q)}&niche=${encodeURIComponent(n)}&min=${min}&max=${max}`);renderListings(d.listings)}
async function listing(id){const d=await api("/listings/"+id),l=d.listing;app.innerHTML=`<div class="container"><a class="muted" href="#/marketplace">← Back to marketplace</a><div class="card" style="margin-top:18px"><div class="sectionhead"><div><span class="badge">${esc(l.verification.replace("_"," "))}</span><h1>${esc(l.title)}</h1><p class="muted">${esc(l.url)} · ${esc(l.niche)} · Seller: ${esc(l.seller_name)}</p></div><div><div class="price">${money(l.asking_price)}</div><small class="muted">asking price</small></div></div><p>${esc(l.description)}</p><div class="metrics"><div class="metric"><small>Monthly revenue</small><strong>${money(l.monthly_revenue)}</strong></div><div class="metric"><small>Monthly profit</small><strong>${money(l.monthly_profit)}</strong></div><div class="metric"><small>Monthly visits</small><strong>${Number(l.monthly_visits).toLocaleString()}</strong></div></div><div class="row"><div class="card"><strong>Website age</strong><p>${l.age_months} months</p></div><div class="card"><strong>Verification</strong><p>${esc(l.verification.replace("_"," "))}</p></div></div><div class="actions" style="justify-content:flex-start;margin-top:20px"><button onclick="favorite(${l.id})">Save listing</button>${state.user?`<button class="btn dark" onclick="offerModal(${l.id},${l.seller_id})">Make offer</button><button class="btn alt" onclick="messageModal(${l.id},${l.seller_id})">Message seller</button>`:`<a class="btn" href="#/login">Log in to make an offer</a>`}</div></div></div>`}
async function favorite(id){if(!state.user)return location.hash="#/login";try{await api("/favorites/"+id,{method:"POST"});toast("Saved to your favorites")}catch(e){toast(e.message)}}
function modal(html){const m=document.createElement("div");m.className="modal";m.innerHTML=`<div>${html}</div>`;m.onclick=e=>{if(e.target===m)m.remove()};document.body.appendChild(m)}
function offerModal(id){modal(`<h2>Make an offer</h2><p class="muted">Your offer will be sent to the seller.</p><form class="form" onsubmit="submitOffer(event,${id})"><label>Offer amount</label><input name="amount" type="number" min="1" required><label>Message</label><textarea name="message" placeholder="Introduce yourself and explain the offer."></textarea><button>Submit offer</button></form>`)}
async function submitOffer(e,id){e.preventDefault();const f=new FormData(e.target);try{await api("/offers",{method:"POST",body:JSON.stringify({listing_id:id,amount:f.get("amount"),message:f.get("message")})});e.target.closest(".modal").remove();toast("Offer submitted")}catch(x){toast(x.message)}}
function messageModal(id,recipient){modal(`<h2>Message seller</h2><form class="form" onsubmit="sendMessage(event,${id},${recipient})"><label>Message</label><textarea name="body" required placeholder="Ask a question about the website..."></textarea><button>Send message</button></form>`)}
async function sendMessage(e,id,r){e.preventDefault();const body=new FormData(e.target).get("body");try{await api("/messages",{method:"POST",body:JSON.stringify({listing_id:id,recipient_id:r,body})});e.target.closest(".modal").remove();toast("Message sent")}catch(x){toast(x.message)}}
function login(){app.innerHTML=`<div class="container"><form class="card form" onsubmit="doLogin(event)"><h1>Log in</h1><label>Email</label><input name="email" type="email" required><label>Password</label><input name="password" type="password" required><button>Log in</button><p class="muted">No account? <a href="#/register">Create one</a></p></form></div>`}
async function doLogin(e){e.preventDefault();const f=new FormData(e.target);try{setSession(await api("/auth/login",{method:"POST",body:JSON.stringify(Object.fromEntries(f))}));location.hash="#/dashboard"}catch(x){toast(x.message)}}
function register(){app.innerHTML=`<div class="container"><form class="card form" onsubmit="doRegister(event)"><h1>Create your account</h1><label>Name</label><input name="name" required><label>Email</label><input name="email" type="email" required><label>Password</label><input name="password" type="password" minlength="8" pattern="(?=.*[A-Za-z])(?=.*\\d).{8,}" title="At least 8 characters, with a letter and a number" required><small class="muted">At least 8 characters, including a letter and a number.</small><label>I want to</label><select name="role"><option value="buyer">Buy websites</option><option value="seller">Sell websites</option></select><button>Create account</button><p class="muted">Already registered? <a href="#/login">Log in</a></p></form></div>`}
async function doRegister(e){e.preventDefault();const f=new FormData(e.target);try{setSession(await api("/auth/register",{method:"POST",body:JSON.stringify(Object.fromEntries(f))}));location.hash="#/dashboard"}catch(x){toast(x.message)}}
function sell(){if(!state.user)return location.hash="#/login";if(!["seller","admin"].includes(state.user.role))return app.innerHTML=`<div class="container"><div class="card empty"><h2>Seller account required</h2><p>Create a seller account to list a website.</p></div></div>`;getSiteSettings().then(()=>{app.innerHTML=`<div class="container"><form class="card form" onsubmit="createListing(event)"><h1>Sell your website</h1><p class="muted">Listings are submitted for admin review before becoming active.</p><label>Listing title</label><input name="title" placeholder="Profitable finance blog" required><label>Website URL</label><input name="url" type="url" placeholder="https://example.com" required><label>Niche</label><select name="niche">${nicheOptions()}</select><div class="row"><div><label>Asking price ($)</label><input name="asking_price" type="number" required></div><div><label>Website age (months)</label><input name="age_months" type="number" min="0"></div></div><div class="row"><div><label>Monthly revenue ($)</label><input name="monthly_revenue" type="number"></div><div><label>Monthly profit ($)</label><input name="monthly_profit" type="number"></div></div><label>Monthly visits</label><input name="monthly_visits" type="number"><label>Description</label><textarea name="description" required placeholder="Explain traffic sources, monetization, expenses, assets included and why you are selling."></textarea><button>Submit listing</button></form></div>`})}
async function createListing(e){e.preventDefault();const f=new FormData(e.target);try{await api("/listings",{method:"POST",body:JSON.stringify(Object.fromEntries(f))});toast("Listing submitted for review");location.hash="#/dashboard"}catch(x){toast(x.message)}}
async function dashboard(){if(!state.user)return location.hash="#/login";const offers=await api("/offers");let extra="";if(["seller","admin"].includes(state.user.role)){const ls=await api("/my/listings");extra=`<h2>My listings</h2><table class="table"><tr><th>Website</th><th>Price</th><th>Status</th><th>Verification</th></tr>${ls.listings.map(l=>`<tr><td>${esc(l.title)}</td><td>${money(l.asking_price)}</td><td>${esc(l.status)}</td><td>${esc(l.verification)}</td></tr>`).join("")}</table>`}app.innerHTML=`<div class="container"><div class="dashboard"><aside class="side"><h3>Dashboard</h3><a href="#/dashboard">Overview</a><a href="#/sell">Create listing</a><a href="#/marketplace">Browse marketplace</a>${state.user.role==="admin"?`<a href="#/admin">Admin panel</a>`:""}<a href="#" onclick="logout()">Log out</a></aside><section><h1>Welcome, ${esc(state.user.name)}</h1><div class="stats"><div class="card stat"><small>Role</small><strong>${esc(state.user.role)}</strong></div><div class="card stat"><small>Offers</small><strong>${offers.offers.length}</strong></div></div><br>${extra}<h2>Offers</h2><table class="table"><tr><th>Listing</th><th>Amount</th><th>Status</th><th>Buyer</th></tr>${offers.offers.map(o=>`<tr><td>${esc(o.listing_title)}</td><td>${money(o.amount)}</td><td>${esc(o.status)}</td><td>${esc(o.buyer_name)}</td></tr>`).join("")||`<tr><td colspan="4" class="empty">No offers yet.</td></tr>`}</table></section></div></div>`}
let adminTab="overview";
async function adminPage(){
  if(!state.user||state.user.role!=="admin")return location.hash="#/login";
  const s=await api("/admin/stats");
  const tabs=[["overview","Overview"],["listings","Listings"],["users","Users"],["reports","Reports"],["settings","Settings"]];
  app.innerHTML=`<div class="container"><div class="sectionhead"><div><h1>Admin control center</h1><p class="muted">Manage listings, users, reports and site settings.</p></div></div>
  <div class="stats"><div class="card stat"><small>Users</small><strong>${s.users}</strong></div><div class="card stat"><small>Listings</small><strong>${s.listings}</strong></div><div class="card stat"><small>Offers</small><strong>${s.offers}</strong></div><div class="card stat"><small>Open reports</small><strong>${s.reports}</strong></div></div>
  <div class="toolbar" style="margin-top:24px">${tabs.map(([k,label])=>`<button class="${adminTab===k?"":"btn alt"}" onclick="setAdminTab(\'${k}\')">${label}</button>`).join("")}</div>
  <div id="adminBody" style="margin-top:18px"></div></div>`;
  renderAdminTab();
}
function setAdminTab(t){adminTab=t;adminPage()}
async function renderAdminTab(){
  const el=document.getElementById("adminBody");
  el.innerHTML=`<div class="card empty">Loading...</div>`;
  try{
    if(adminTab==="overview")return renderAdminOverview(el);
    if(adminTab==="listings")return renderAdminListings(el);
    if(adminTab==="users")return renderAdminUsers(el);
    if(adminTab==="reports")return renderAdminReports(el);
    if(adminTab==="settings")return renderAdminSettings(el);
  }catch(e){el.innerHTML=`<div class="card empty"><h2>Something went wrong</h2><p>${esc(e.message)}</p></div>`}
}
function renderAdminOverview(el){el.innerHTML=`<div class="card"><h2>Welcome back</h2><p class="muted">Use the tabs above to review pending listings, manage users, resolve reports, and configure site-wide settings like commission rate and niches.</p></div>`}

async function renderAdminListings(el){
  const d=await api("/admin/listings");
  el.innerHTML=`<table class="table"><tr><th>Listing</th><th>Seller</th><th>Status</th><th>Verification</th><th>Featured</th><th>Action</th></tr>${d.listings.map(l=>`<tr><td>${esc(l.title)}</td><td>${esc(l.seller_name)}</td><td><select id="st${l.id}"><option ${l.status==="active"?"selected":""}>active</option><option ${l.status==="pending"?"selected":""}>pending</option><option ${l.status==="rejected"?"selected":""}>rejected</option><option ${l.status==="sold"?"selected":""}>sold</option></select></td><td><select id="vf${l.id}"><option ${l.verification==="unverified"?"selected":""}>unverified</option><option ${l.verification==="partially_verified"?"selected":""}>partially_verified</option><option ${l.verification==="verified"?"selected":""}>verified</option></select></td><td><input type="checkbox" id="ft${l.id}" ${l.featured?"checked":""}></td><td><button onclick="adminUpdate(${l.id})">Save</button></td></tr>`).join("")}</table>`;
}
async function adminUpdate(id){try{await api("/admin/listings/"+id,{method:"PATCH",body:JSON.stringify({status:document.getElementById("st"+id).value,verification:document.getElementById("vf"+id).value,featured:document.getElementById("ft"+id).checked})});toast("Listing updated");renderAdminTab()}catch(e){toast(e.message)}}

async function renderAdminUsers(el){
  const d=await api("/admin/users");
  el.innerHTML=`<table class="table"><tr><th>Name</th><th>Email</th><th>Role</th><th>Listings</th><th>Offers</th><th>Status</th><th>Action</th></tr>${d.users.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td><select id="role${u.id}" ${u.id===state.user.id?"disabled":""}><option ${u.role==="buyer"?"selected":""}>buyer</option><option ${u.role==="seller"?"selected":""}>seller</option><option ${u.role==="admin"?"selected":""}>admin</option></select></td><td>${u.listing_count}</td><td>${u.offer_count}</td><td>${u.banned?'<span class="badge pending">banned</span>':'<span class="badge">active</span>'}</td><td>${u.id===state.user.id?`<span class="muted">You</span>`:`<button onclick="adminSetRole(${u.id})">Save role</button> <button class="btn ${u.banned?'alt':'dark'}" onclick="adminToggleBan(${u.id},${!u.banned})">${u.banned?"Unban":"Ban"}</button>`}</td></tr>`).join("")}</table>`;
}
async function adminSetRole(id){try{await api("/admin/users/"+id,{method:"PATCH",body:JSON.stringify({role:document.getElementById("role"+id).value})});toast("Role updated");renderAdminTab()}catch(e){toast(e.message)}}
async function adminToggleBan(id,banned){try{await api("/admin/users/"+id,{method:"PATCH",body:JSON.stringify({banned})});toast(banned?"User banned":"User unbanned");renderAdminTab()}catch(e){toast(e.message)}}

async function renderAdminReports(el){
  const d=await api("/admin/reports");
  if(!d.reports.length){el.innerHTML=`<div class="card empty">No reports yet.</div>`;return}
  el.innerHTML=`<table class="table"><tr><th>Listing</th><th>Reporter</th><th>Reason</th><th>Status</th><th>Action</th></tr>${d.reports.map(r=>`<tr><td>${esc(r.listing_title)}</td><td>${esc(r.reporter_name)}</td><td>${esc(r.reason)}${r.details?`<br><small class="muted">${esc(r.details)}</small>`:""}</td><td>${esc(r.status)}</td><td>${r.status==="open"?`<button onclick="adminResolveReport(${r.id},'resolved')">Resolve</button> <button class="btn alt" onclick="adminResolveReport(${r.id},'dismissed')">Dismiss</button>`:`<button class="btn alt" onclick="adminResolveReport(${r.id},'open')">Reopen</button>`}</td></tr>`).join("")}</table>`;
}
async function adminResolveReport(id,status){try{await api("/admin/reports/"+id,{method:"PATCH",body:JSON.stringify({status})});toast("Report updated");renderAdminTab()}catch(e){toast(e.message)}}

async function renderAdminSettings(el){
  const d=await api("/admin/settings");
  const s=d.settings;
  el.innerHTML=`<form class="card form" onsubmit="saveAdminSettings(event)" style="max-width:none">
    <label>Site name</label><input name="site_name" value="${esc(s.site_name.value)}" required>
    <label>Support email</label><input name="support_email" type="email" value="${esc(s.support_email.value)}" required>
    <label>Commission rate (%)</label><input name="commission_rate" type="number" min="0" max="100" step="0.1" value="${esc(s.commission_rate.value)}" required>
    <label>Niches (one per line)</label><textarea name="niches" required>${esc(s.niches.value.join("\n"))}</textarea>
    <label style="display:flex;align-items:center;gap:8px;margin-top:18px"><input type="checkbox" name="require_verification_to_list" style="width:auto" ${s.require_verification_to_list.value==="true"?"checked":""}> Require verification before a listing can go active</label>
    <button style="margin-top:18px">Save settings</button>
  </form>`;
}
async function saveAdminSettings(e){
  e.preventDefault();
  const f=new FormData(e.target);
  const niches=String(f.get("niches")||"").split("\n").map(x=>x.trim()).filter(Boolean);
  try{
    await api("/admin/settings",{method:"PATCH",body:JSON.stringify({
      site_name:f.get("site_name"),
      support_email:f.get("support_email"),
      commission_rate:f.get("commission_rate"),
      niches,
      require_verification_to_list:f.get("require_verification_to_list")?"true":"false",
    })});
    siteSettings=null;
    toast("Settings saved");
  }catch(x){toast(x.message)}
}
function how(){app.innerHTML=`<div class="container"><div class="card"><h1>How SiteMarket works</h1><div class="row"><div><h3>1. Sellers list</h3><p class="muted">Provide the URL, business details, traffic, revenue, profit and asking price.</p></div><div><h3>2. Admin reviews</h3><p class="muted">Listings start as pending and can be reviewed before publication.</p></div><div><h3>3. Buyers evaluate</h3><p class="muted">Compare metrics, save opportunities and contact sellers.</p></div><div><h3>4. Make an offer</h3><p class="muted">Submit an offer and negotiate directly. Add compliant payment/escrow later.</p></div></div></div></div>`}
async function route(){renderNav();const p=location.hash.slice(1)||"/";try{if(p==="/")return home();if(p==="/marketplace")return marketplace();if(p==="/login")return login();if(p==="/register")return register();if(p==="/sell")return sell();if(p==="/dashboard")return dashboard();if(p==="/admin")return adminPage();if(p==="/how")return how();if(p.startsWith("/listing/"))return listing(p.split("/")[2]);home()}catch(e){app.innerHTML=`<div class="container"><div class="card empty"><h2>Something went wrong</h2><p>${e.message}</p></div></div>`}}
window.addEventListener("hashchange",route);route();
