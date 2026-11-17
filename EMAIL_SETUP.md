# Website email setup

The site sends wallet request and review updates from a Supabase Edge Function through Resend. The email subject and body state clearly that the wallet activity is simulated and no money or cryptocurrency moved. Supabase Auth uses SMTP for sign-up confirmations and password emails.

## Before sending to customers

1. Own a domain name, for example `yourdomain.com`. The GitHub Pages address `usacryptobit.github.io` is not a domain you control and cannot be used to verify a sender address.
2. Create a Resend account and add your domain in its Domains page.
3. Add the DNS records Resend displays at your domain provider. Wait for Resend to show the domain as verified.
4. Create a Resend API key and choose a sender address on the verified domain, such as `no-reply@yourdomain.com`.

## Add the sender credentials to Supabase

In PowerShell opened in this project folder, run the following commands, replacing the example API key and domain with your own values:

```powershell
supabase secrets set RESEND_API_KEY="re_your_real_key"
supabase secrets set EMAIL_FROM="USA CryptoBit <no-reply@yourdomain.com>" SITE_URL="https://usacryptobit.github.io/"
supabase functions deploy customer-email --project-ref wduxagzffigciuwidkvn --no-verify-jwt
```

The function verifies each Supabase session itself. Never put the Resend API key in a `VITE_` variable, browser code, GitHub file, or commit.

## Send sign-up and password emails

In the Supabase dashboard, open **Authentication → SMTP Settings** and enable custom SMTP:

- Host: `smtp.resend.com`
- Port: `465`
- Username: `resend`
- Password: your Resend API key
- Sender email: the verified `no-reply@yourdomain.com` address
- Sender name: `USA CryptoBit`

Save the settings. Supabase Auth will then use that provider for its confirmation and password emails. Keep email confirmation enabled.

## Customer replies

This setup sends outgoing account emails; it does not add an inbox or reply screen to the website. For customer replies, create a mailbox such as `support@yourdomain.com` with a mail-hosting provider and configure a reply-to address for the sender. Resend also has separate inbound-email and shared-inbox products; those need their own setup and are not part of this integration.
