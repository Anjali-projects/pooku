# Quick Start Guide

## 🚀 Get Running in 3 Minutes

### 1. Open Terminal in Backend Folder

```bash
cd "Habit tracker/backend"
```

### 2. Install Dependencies

```bash
npm install
```

Wait for completion (first time takes 1-2 minutes)

### 3. Start Server

```bash
npm start
```

You should see:
```
✓ Database initialized successfully
✓ Server running on http://localhost:5000
```

### 4. Open in Browser

Click here or copy-paste: **http://localhost:5000/frontend/login.html**

### 5. Create Account

- Click **Register**
- Enter any username, email, password
- Click **Create Account ✨**

### 6. Start Tracking!

- Add today's completed habits
- Add mood and notes
- Click "Save today ✓"

---

## ⚙️ Common Commands

### Start Server (Normal)
```bash
npm start
```

### Start Server (With Auto-Reload)
```bash
npm run dev
```

### Stop Server
Press `Ctrl + C` in terminal

### Change Server Port
Edit `backend/.env`:
```
PORT=5001
```

---

## 📱 Access Points

| Page | URL |
|------|-----|
| Login/Register | http://localhost:5000/frontend/login.html |
| Main App | http://localhost:5000/frontend/tracker.html |

---

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| "npm: command not found" | Install Node.js from nodejs.org |
| "Port 5000 in use" | Change PORT in backend/.env |
| "Connection error" | Make sure backend is running with `npm start` |
| "No database" | Delete backend folder and reinstall: `npm install` |

---

## 📚 Next Steps

1. Read `README.md` for full documentation
2. Check `backend/README.md` for API details
3. Explore the code and customize as needed

Happy tracking! 🌸
