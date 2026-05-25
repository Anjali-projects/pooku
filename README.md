# 🌸 Habit Tracker - Full Stack Project

A beautiful, full-stack habit tracking application with user authentication, SQLite database, and real-time syncing.

## Features

✨ **User Authentication**
- Secure registration and login system
- JWT token-based authentication
- Password hashing with bcryptjs

📊 **Habit Management**
- Create and manage custom habits
- Add emoji icons to habits
- Delete habits anytime

🎯 **Daily Tracking**
- Mark habits as complete for each day
- Mood tracking (Happy, Calm, Tired, Stressed, Motivated, Meh)
- Daily journal entries
- Progress visualization

📈 **Progress Analytics**
- Track days completed
- View best streaks
- Per-habit completion rates
- Last 7 days performance chart

🔔 **Reminders**
- Set daily notification reminders
- Browser notifications support

💾 **Data Storage**
- SQLite database for reliable storage
- Multi-user support
- Real-time data persistence

## Project Structure

```
habit-tracker/
├── backend/
│   ├── server.js          # Express server & API routes
│   ├── db.js              # SQLite database initialization
│   ├── auth.js            # JWT authentication middleware
│   ├── package.json       # Backend dependencies
│   ├── .env               # Environment variables
│   └── README.md          # Backend documentation
├── frontend/
│   ├── login.html         # Login/Registration page
│   ├── tracker.html       # Main tracker application
├── database/
│   └── habit_tracker.db   # SQLite database (created automatically)
└── README.md              # This file
```

## Prerequisites

- **Node.js** (v14 or higher) - [Download](https://nodejs.org/)
- **npm** (comes with Node.js)
- A modern web browser

## Installation

### Step 1: Install Backend Dependencies

```bash
cd backend
npm install
```

### Step 2: Configure Environment

Create a `.env` file in the `backend` folder (already provided with defaults):

```
PORT=5000
JWT_SECRET=your-secret-key-change-in-production
NODE_ENV=development
```

### Step 3: Start the Backend Server

From the `backend` folder:

```bash
npm start
```

Or with auto-reload (development):

```bash
npm run dev
```

You should see:
```
✓ Database initialized successfully
✓ Server running on http://localhost:5000
```

### Step 4: Access the Frontend

Open your browser and go to:

```
http://localhost:5000/frontend/login.html
```

Or simply:
```
http://localhost:5000
```

## How to Use

### 1. Create an Account

- Click on the **Register** tab
- Fill in username, email, and password
- Click "Create Account ✨"
- You'll get 6 default habits to get started

### 2. Track Your Habits

- Click on any habit card to mark it complete
- Watch your daily progress update
- Add mood and journal notes for the day
- Click "Save today ✓" to persist your entries

### 3. Manage Your Habits

- Go to **My Habits** tab
- Select an emoji and enter habit name
- Click "+ Add habit"
- Delete habits using the × button

### 4. View Progress

- Go to **Progress** tab
- See statistics (days tracked, total completed, best streak)
- View last 7 days performance
- Check per-habit completion rates

### 5. Set Reminders

- Click "🔔 Remind me" button
- Select your preferred reminder time
- Allow browser notifications when prompted
- Get daily notifications at your set time

## API Endpoints

### Authentication
```
POST /api/auth/register
POST /api/auth/login
```

### Habits (Requires authentication)
```
GET    /api/habits
POST   /api/habits
DELETE /api/habits/:id
```

### Completions & Logs (Requires authentication)
```
POST /api/logs/toggle              # Toggle habit completion
GET  /api/logs/:logDate             # Get completions for a date
POST /api/logs/save                 # Save mood and journal
GET  /api/logs/details/:logDate     # Get mood and journal
GET  /api/logs                      # Get all logs
GET  /api/stats                     # Get user statistics
```

## Database Schema

### users
```sql
id (Primary Key)
username (UNIQUE)
email (UNIQUE)
password (hashed)
created_at
```

### habits
```sql
id (Primary Key)
user_id (Foreign Key)
name
icon
created_at
```

### completions
```sql
id (Primary Key)
user_id (Foreign Key)
habit_id (Foreign Key)
log_date (UNIQUE per user-habit pair)
completed_at
```

### logs
```sql
id (Primary Key)
user_id (Foreign Key)
log_date
mood
journal
created_at
```

## Common Issues & Solutions

### "Connection error. Make sure the backend is running"

**Solution:** Make sure the backend server is running:
```bash
cd backend
npm start
```

### "Port 5000 already in use"

**Solution:** Change the port in `.env`:
```
PORT=5001
```

Then access frontend at `http://localhost:5001/frontend/login.html`

### "Module not found" errors

**Solution:** Reinstall dependencies:
```bash
cd backend
npm install
```

### Database file not creating

**Solution:** Ensure `/database` folder exists and is writable. The database will be created automatically on first run.

### Notifications not showing

**Solution:** 
- Browser must have permission to show notifications
- Check browser settings under Privacy & Security → Notifications
- Make sure you clicked "Allow" when prompted

## Development Tips

### Testing the API directly

Use curl or Postman:

```bash
# Register
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"test@email.com","password":"password123"}'

# Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"password123"}'

# Get habits (use token from login response)
curl -X GET http://localhost:5000/api/habits \
  -H "Authorization: Bearer <your_token>"
```

### Enable CORS for different domains

Edit `server.js` and modify the CORS configuration:
```javascript
app.use(cors({
  origin: 'http://yourdomain.com',
  credentials: true
}));
```

### Production Deployment

Before deploying:

1. Change JWT_SECRET to a secure random string:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

2. Update `.env`:
```
NODE_ENV=production
JWT_SECRET=<your-secure-secret>
```

3. Use a production database (consider PostgreSQL or MySQL)
4. Deploy to platforms like Heroku, Railway, or DigitalOcean

## Technologies Used

- **Backend**: Node.js, Express.js
- **Database**: SQLite3
- **Authentication**: JWT, bcryptjs
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **API**: RESTful API with JSON
- **Utilities**: express-validator for input validation

## Future Enhancements

- [ ] Habit statistics and analytics
- [ ] Share progress with friends
- [ ] Habit templates
- [ ] Mobile app version
- [ ] Dark mode
- [ ] Export data to CSV
- [ ] Social features (following friends, challenges)
- [ ] Habit recommendations based on psychology

## License

MIT License - Feel free to use this project for personal or commercial use.

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the backend logs in the terminal
3. Check browser console for frontend errors (F12)
4. Create an issue on GitHub

---

Built with ❤️ using Node.js, SQLite, and modern web technologies.

Happy tracking! 🌸
