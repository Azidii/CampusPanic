# CampusPanic Web Console (Express + EJS)

Unified Security Operations Center (SOC) web application built with Node.js, Express, EJS, and Socket.IO.

## Project Structure

```
DSP-Website/
├── config/              # Database connection and environment configuration
│   ├── config.js
│   └── db.js
├── css/                 # Dedicated CSS stylesheet for each view
│   ├── common.css       # Design system tokens, layout, typography, components
│   ├── login.css
│   ├── dashboard.css
│   ├── cam-view.css
│   ├── all-cams.css
│   ├── map-view.css
│   ├── active-nodes-map.css
│   ├── broadcaster.css
│   ├── profile.css
│   ├── settings.css
│   ├── admin-users.css
│   └── 404.css
├── js/                  # Client-side JavaScript controllers
│   ├── common.js        # Socket.IO, theme manager, Web Audio siren, toasts
│   ├── login.js
│   ├── dashboard.js
│   ├── cam-view.js
│   ├── all-cams.js
│   ├── map-view.js
│   ├── active-nodes-map.js
│   ├── broadcaster.js
│   ├── profile.js
│   ├── settings.js
│   └── admin-users.js
├── middleware/          # Security, auth, and file upload middlewares
│   ├── auth.js
│   ├── deviceAuth.js
│   ├── errorHandler.js
│   └── upload.js
├── models/              # Mongoose database models
│   ├── Alert.js
│   ├── Camera.js
│   ├── Node.js
│   └── User.js
├── public/              # Static SVG icons and favicons
│   ├── favicon.svg
│   └── icons.svg
├── routes/              # Express page and API routers
│   ├── viewRoutes.js    # SSR EJS page controllers
│   ├── alertRoutes.js   # Incident feed and IoT ingest API
│   ├── authRoutes.js    # JWT authentication API
│   ├── cameraRoutes.js  # Camera frame transmission API
│   ├── nodeRoutes.js    # ESP32 room node telemetry API
│   ├── profileRoutes.js # Operator profile API
│   └── userRoutes.js    # Admin user management API
├── scripts/             # Seed and test scripts
│   ├── seed.js          # Seeds users, room nodes, cameras, and sample alerts
│   └── simulate-alert.js# Sends simulated IoT packets with checksum verification
├── sockets/             # Socket.IO real-time event handlers
│   └── socketHandler.js
├── uploads/             # Captured emergency frame storage
│   └── alerts/
├── views/               # EJS template views
│   ├── partials/        # Reusable view components
│   │   ├── head.ejs
│   │   ├── navbar.ejs
│   │   ├── sidebar.ejs
│   │   ├── footer.ejs
│   │   └── scripts.ejs
│   ├── login.ejs
│   ├── dashboard.ejs
│   ├── cam-view.ejs
│   ├── all-cams.ejs
│   ├── map-view.ejs
│   ├── active-nodes-map.ejs
│   ├── broadcaster.ejs
│   ├── profile.ejs
│   ├── settings.ejs
│   ├── admin-users.ejs
│   └── 404.ejs
├── server.js            # Main Express application entrypoint
├── package.json
└── .env
```

## Setup & Running

1. **Install dependencies:**
   ```bash
   cd DSP-Website
   npm install
   ```

2. **Seed sample data:**
   ```bash
   npm run seed
   ```
   * Default Admin: `admin@campuspanic.edu` / `Admin123!`
   * Default Guard: `guard@campuspanic.edu` / `Guard123!`

3. **Start the server:**
   ```bash
   npm start
   ```
   Open `http://localhost:5000` in your web browser.

4. **Run IoT Alert Simulator (Optional):**
   ```bash
   npm run simulate
   ```
