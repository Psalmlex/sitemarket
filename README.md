# SiteMarket — Website Marketplace MVP

A production-oriented MVP for buying and selling websites.

## Included
- Public marketplace with search and filters
- Website listing detail pages
- Buyer and seller registration/login
- Seller listing creation
- Buyer saved listings and offers
- Seller offer management
- Messaging-ready data model
- Admin dashboard for users/listings/reports
- Listing verification status
- PostgreSQL schema
- Demo seed data
- REST API with Express
- Responsive vanilla JS frontend
- Render-ready deployment configuration

## Quick start

1. Install Node.js 20+ and PostgreSQL.
2. Copy `.env.example` to `.env`.
3. Create a PostgreSQL database.
4. Run:
   npm install
   npm run db:init
   npm run seed
   npm run dev
5. Open http://localhost:3000

### Demo accounts
- Admin: admin@sitemarket.local / Admin123!
- Seller: seller@sitemarket.local / Seller123!
- Buyer: buyer@sitemarket.local / Buyer123!

Change demo passwords before deployment.

## Render
Create a PostgreSQL database and a Web Service pointing to this repository.

Build command:
npm install

Start command:
npm start

Set environment variables from `.env.example`.

## Important
This MVP does not provide regulated escrow or custody of user funds. The included offer flow records deal intent. Integrate a compliant payment/escrow provider after legal and payment-provider review.
