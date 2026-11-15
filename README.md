# USA CryptoBit

A responsive crypto market dashboard built with React, Vite, and Supabase. It shows CoinGecko market data, account sign-in/sign-up, a private watchlist, and a Virtual Wallet for simulated balances. The wallet does not custody cryptocurrency or execute trades, transfers, deposits, or withdrawals.

## 1. Set up Supabase

1. Open the SQL Editor in your Supabase project.
2. Paste and run [`supabase/schema.sql`](supabase/schema.sql).
3. The project URL and publishable key you supplied are already set as defaults. If you rotate them, update `src/supabase.js` or set the environment variables below. The publishable key (`sb_publishable_...`) is designed for browser use. Never use a secret/service-role key in this site.
4. In **Authentication → URL Configuration**, set **Site URL** to `https://usacryptobit.github.io/` and allow it in **Redirect URLs**. Add `http://localhost:5173/**` for local development.
5. If you want accounts to work immediately, review **Authentication → Providers → Email** and your email confirmation settings.

The SQL creates profiles, watchlists, and Virtual Wallet tables, enables row-level security, and limits each customer to their own records. Wallet units are simulated and non-redeemable; the generated `VIRTUAL-…` IDs are for display only and are not deposit addresses.

## 2. Run locally

```bash
cp .env.example .env.local
```

Edit `.env.local` with your project URL and publishable key:

```env
VITE_SUPABASE_URL=https://wduxagzffigciuwidkvn.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_IUVT-wBn6VGAr6AR4ap9JA_j1ilAbZE
```

Then run:

```bash
npm install
npm run dev
```

The supplied Supabase configuration is already included. If you remove it, the dashboard still opens in preview mode with sample prices; sign-in and saved lists require Supabase configuration.

## 3. Deploy from GitHub

1. Create an empty GitHub repository named `usacryptobit`. From this project folder, run (replace the URL with your repository's HTTPS URL):

   ```bash
   git init
   git add .
   git commit -m "Build USA CryptoBit website"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/usacryptobit.git
   git push -u origin main
   ```

   If you already have a repository, copy these project files into its root and commit/push them to `main`.
2. (Optional) In the repository, open **Settings → Secrets and variables → Actions → Variables** and add/override:
   - `VITE_SUPABASE_URL` = your Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY` = your Supabase publishable key
3. Open **Settings → Pages** and set the source to **GitHub Actions**.
4. Push to `main` (or run the workflow under **Actions → Deploy to GitHub Pages**).
5. Once deployed, copy the Pages URL into Supabase Auth URL Configuration as described above.

GitHub Actions builds the site using the repository variables and publishes the `dist` directory. Since these are public browser configuration values, GitHub Actions variables are appropriate; do not add a Supabase secret/service-role key.

## 4. Set up administrator access

The administrator area lets you search customer accounts, see account creation/last sign-in/email verification, apply a read-only watchlist restriction, suspend sign-in for 24 hours, 7 days, 30 days, or permanently, and restore access. Timed suspensions expire automatically. Every access change requires a reason and is recorded in the admin activity log. Administrators cannot change their own access or another administrator's access from this screen.

### Install the database controls and Virtual Wallet

Run the updated [`supabase/schema.sql`](supabase/schema.sql) in your project's SQL Editor. It adds protected `user_roles`, `account_controls`, and `admin_action_log` tables; customer Virtual Wallet balances, ledger, conversion and request functions; and database policies. Admin funding and request review are available only through the role-checked Edge Function. If you have already run an earlier version, run this updated script again so it adds the wallet tables and signup trigger setup. The script also changes earlier wallet ID display values and ledger notes to use Virtual Wallet wording.

### Deploy the server-side admin function

From this project folder in PowerShell, authenticate the Supabase CLI and deploy the function to your project:

```powershell
npx.cmd supabase login
npx.cmd supabase functions deploy admin-users --project-ref wduxagzffigciuwidkvn
```

Supabase injects the server secret into Edge Functions. The function checks the signed-in user's role before listing customers, changing access, funding virtual balances, pausing requests, or reviewing a request. Do not add a Supabase secret/service-role key to GitHub, the browser app, or `.env` files.

### Promote your own account to admin

1. Create your account through **Sign in → Create account** on the site and confirm your email.
2. In Supabase **SQL Editor**, run this query with the same email you used to sign up:

   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'admin'
   from auth.users
   where lower(email) = lower('YOUR-EMAIL@example.com')
   on conflict (user_id) do update set role = excluded.role;
   ```

3. Sign out and back in, then open the site's **Admin** section.

If the query reports that it inserted zero rows, confirm the account exists in **Authentication → Users** and that the email matches. Only use the SQL Editor to grant administrator roles; a customer cannot grant a role to themselves through the site.

### Publish the updated site

Commit and push the updated site files to the `usacryptobit.github.io` repository. GitHub Pages will deploy the Admin and Virtual Wallet sections. The SQL schema and Edge Function must also be installed in Supabase as described above; GitHub Pages cannot run server-side admin actions by itself.

### Virtual Wallet behavior

- New accounts receive empty virtual asset balances and stable `VIRTUAL-…` IDs that are not blockchain addresses.
- Admins can add non-redeemable virtual units, pause or resume a customer's virtual withdrawal requests, and hold, release, approve (mark processed), or reject requests.
- Customers can convert virtual units at the displayed market quote less a simulated 0.5% fee. A conversion is an in-app practice ledger entry only.
- Customer requests move virtual units into a held balance until reviewed. An approval never sends funds; a rejection returns the units to the available virtual balance.
- Every virtual wallet screen says the balances are simulated. Do not use this wallet to accept real deposits or promise real withdrawals.

## Market data

Prices load from CoinGecko's public `/coins/markets` endpoint and refresh once a minute. If that endpoint is unavailable or rate-limited, the UI falls back to clearly labeled sample values. Check CoinGecko's current API terms and rate limits before using this publicly at scale; a production deployment may need a server-side cache.
