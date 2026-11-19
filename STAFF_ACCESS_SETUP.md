# Staff access setup

## Enable the staff feature

1. Open the project’s **Supabase SQL Editor**.
2. Open `supabase/staff_access.sql` from this folder, copy the whole file into a new SQL query, and click **Run** once.
3. In PowerShell opened at this project folder, deploy the updated `admin-users` function:

   ```powershell
   supabase functions deploy admin-users --project-ref wduxagzffigciuwidkvn
   ```

4. Push the website code to GitHub `main` using GitHub Desktop so the staff page is published.

## Add a staff member

1. Ask them to register and confirm an account on the website first.
2. Sign in to the site as the administrator and open **Admin**.
3. Under **Choose staff tasks and customers**, select their registered account.
4. Tick only the tasks they should perform, select the customer accounts they may handle, then click **Grant staff access**.
5. The staff member signs in with their own account. They will see the **Admin** workspace with only their assigned customers and enabled tasks.

The available tasks are customer access controls, support messages, virtual wallet funding, and virtual deposit/withdrawal review. Staff cannot grant staff access or reset wallets. Changes are checked by the server and customer data policies, not only by the page interface. Wallet actions remain simulated; no money or cryptocurrency moves.
