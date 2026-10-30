# Anonymous daily analytics setup

The `/admin` dashboard uses Cloudflare Pages Functions and a D1 database. It stores one SHA-256 hash for each anonymous browser token and day. The token is regenerated daily in the browser; it does not include document data, an IP address, a name, or an email address.

1. In Cloudflare, create a D1 database for SmartForms.
2. Run `migrations/0001_daily_visits.sql` against that database using the D1 Console or Wrangler.
3. In Pages > SmartForms > Settings > Functions, add a D1 binding named `ANALYTICS_DB` that points to the new database.
4. In Pages > SmartForms > Settings > Environment variables, add these production secrets:
   - `ADMIN_USERNAME`: the private admin username.
   - `ADMIN_PASSWORD`: the private admin password.
   - `ADMIN_SESSION_SECRET`: a random value of at least 32 characters.
5. Redeploy the `main` branch and open `/admin`.

The values are never committed to Git. Use a stronger password than a four-digit PIN before sharing the dashboard publicly.
