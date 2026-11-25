# WishLink — Android + Shareable Gift Wishlist

This is an upgraded full-stack starter project. It includes:
- Owner account (email + password)
- Personal public URL: `/w/yourusername`
- Add/edit/delete wishlist items
- Product URLs, optional image URLs, price, category and notes
- Friends can reserve an item without creating an account
- Gifter chooses whether their name is shown to the owner
- Atomic reservation prevents two people reserving the same item
- Owner confirms delivery; visitors cannot mark items delivered
- Dark mode
- Supabase PostgreSQL backend

## Important: the public link needs a hosted website
An APK installed on your phone cannot by itself create a public internet link. Deploy this same web app to a hosting provider (for example, Vercel or Netlify) so friends can open `https://your-domain/w/yourusername`. The Android APK is the owner-friendly mobile app; the hosted web version is what makes WishLinks accessible to everyone.

## 1. Requirements
- Node.js LTS
- VS Code
- A free Supabase project
- Android Studio + Android SDK for APK builds

## 2. Set up Supabase
1. Create a project at https://supabase.com/dashboard.
2. Open **SQL Editor** in your Supabase project.
3. Open `supabase/schema.sql` from this project, copy all its contents, paste into a new SQL query and click **Run**.
4. Open **Project Settings > API** (or API Keys).
5. Copy the Project URL and the publishable/anon key. Never use the `service_role` or secret key in frontend code.

## 3. Configure this app
In the project folder, make a copy of `.env.example` and name it `.env`.
Fill in:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
```

Save the file. Do not commit `.env` to a public GitHub repository.

## 4. Run locally
Open a terminal in this folder:

```bash
npm install
npm run start
```

Open the localhost URL shown in the terminal. Create an account using an email you can access. If Supabase email confirmation is enabled, confirm the email first and then log in. If confirmation is enabled, a profile row may not be created by the first signup in this starter; after confirming, sign up again is not recommended because the email is already registered. For a first local test, you can temporarily turn off **Authentication > Providers > Email > Confirm email** in Supabase, create the account once, then turn confirmation back on. For production, use a proper email-confirmation profile-creation flow.

## 5. Deploy the shareable website
Deploy the project to Vercel or Netlify:
- Build command: `npm run build`
- Output folder: `dist`
- Add the two environment variables from `.env` in the hosting dashboard.
- Deploy.

For Vercel, add a `vercel.json` rewrite so client-side paths such as `/w/username` serve `index.html`. For Netlify, add a `public/_redirects` file containing `/* /index.html 200` before building (or configure an equivalent SPA fallback).

After deployment, create your account on the hosted site. Your WishLink will be:
`https://YOUR-HOST/w/yourusername`

## 6. Build the Android APK
From the project folder:

```bash
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

Android Studio opens. Wait for Gradle sync, connect your Android phone with USB debugging enabled (or start an emulator), then press Run.

To make an APK: Android Studio > Build > Build Bundle(s) / APK(s) > Build APK(s).

After changing frontend code:
```bash
npm run build
npx cap sync android
```
Then rebuild the APK.

## 7. Gifting flow
1. Owner adds an item and shares their WishLink.
2. Friend opens the public link, checks the product and taps **I want to gift this**.
3. Friend chooses whether their name is revealed and may leave a message.
4. The item shows as reserved. Other visitors cannot reserve it.
5. Owner confirms delivery after receiving the product.

The app does not take payments, place orders, or verify delivery automatically. The owner confirms delivery manually.

## Privacy and safety notes
- Do not add a home address or other private details to public notes.
- A friend should buy through the retailer's own checkout; WishLink does not collect card/payment details.
- The public page does not display gifter identity. The owner can see a name only if the gifter opted to reveal it; otherwise the owner sees that the gifter is anonymous. The owner can also read the optional gift message.
- For production use, review Supabase RLS, enable email confirmation, configure rate limits/CAPTCHA for public reservation RPCs, and add account recovery.
- The reservation RPC is public by design so visitors can reserve without accounts. A production launch should add abuse prevention (rate limits/CAPTCHA) and a reservation cancellation workflow.
