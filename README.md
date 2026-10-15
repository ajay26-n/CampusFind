# CampusFind 🎓🔍

**CampusFind** is a mobile application built with React Native and Expo designed for campus communities to report, discover, track, and reclaim lost and found items.

---

## ✨ Features

- 📱 **Browse Lost & Found Feed**: Filter by lost/found status, category, date, and search keywords.
- 📸 **Post Item Reports**: Upload photos, location details, category tags, and descriptions.
- 🤝 **Claims & Verification**: Submit ownership claims with proof and review claim workflows.
- 🔔 **In-App Notifications**: Real-time updates on claim approvals, item returns, and matches.
- 🛡️ **Role-Based Permissions**: Admin review tools, campus authority verification, and protected operations.
- ⚡ **Supabase Backend**: Real-time Postgres database, Row Level Security (RLS), Supabase Storage, and Auth.

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js (v18+ recommended)
- [Expo Go](https://expo.dev/go) on your mobile device or an iOS/Android simulator

### 2. Installation
Clone the repository and install dependencies:
```bash
npm install
```

### 3. Environment Setup
Copy the `.env.example` file to `.env.local`:
```bash
cp .env.example .env.local
```
Fill in your Supabase project credentials in `.env.local`:
```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 4. Database Setup
Execute the SQL migration scripts in your Supabase SQL editor:
- `supabase_schema_step5.sql`
- `supabase_schema_step5_1_storage.sql`
- `supabase_schema_step6_item_return.sql`
- `supabase_schema_step7_feed_visibility.sql`
- `supabase_schema_step8_notifications.sql`
- `supabase_schema_step9_claims_permissions.sql`
- `supabase_schema_step10_admin_claim_notifications.sql`
- `supabase_schema_step11_lost_item_found_report.sql`

### 5. Running the App
Start the Expo development server:
```bash
npx expo start
```
Scan the QR code with **Expo Go** (Android) or the **Camera app** (iOS).

---

## 🛠️ Tech Stack

- **Framework**: [Expo](https://expo.dev/) (React Native) + [Expo Router](https://docs.expo.dev/router/introduction/)
- **Backend / Database**: [Supabase](https://supabase.com/) (PostgreSQL, Auth, Storage, Realtime)
- **Language**: TypeScript
- **Icons**: Lucide Icons / Expo Vector Icons

---

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

