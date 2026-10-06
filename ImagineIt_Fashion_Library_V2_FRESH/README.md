# ImagineIt Fashion Library — V2

V2 is a real web-app foundation using Supabase for authentication and PostgreSQL storage.

## 1. Create the database
Create a Supabase project, open SQL Editor, and run `schema.sql` in full.

## 2. Create the first admin login
In Supabase Dashboard -> Authentication -> Users, create a user with the email/password you want to use for ImagineIt admin login.

The database trigger automatically creates a profile row.

## 3. Connect the app
Open `config.js` and replace:
- YOUR_SUPABASE_PROJECT_URL
- YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY

Use the browser-safe publishable/anon key only. NEVER put a Supabase service-role key in this app.

## 4. Run
For quick testing, serve the folder with any static web server. Example:
`python -m http.server 8080`
Then open `http://localhost:8080`.

## 5. What V2 includes
- Supabase authentication/login
- PostgreSQL database
- Customer management
- Inventory management
- Rental management
- Monthly availability calendar
- Database-level protection against overlapping active rentals
- Due-today and overdue dashboard
- Return tracking
- Professional customer reminder generation

## Important
Automatic WhatsApp/SMS sending is deliberately not included until a messaging provider is connected. The current reminder flow prepares/copies the message.

For a production launch, add:
- WhatsApp Business Cloud API or another approved messaging provider
- Scheduled Edge Function for daily reminders
- Staff/admin role policies
- Image storage
- Customer-facing booking portal
- Payment integration
- Backups/audit logs
