# Habit Tracker Backend

A full-stack habit tracker with user authentication and SQLite database.

## Installation

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## Configuration

Create a `.env` file in the backend folder:
```
PORT=5000
JWT_SECRET=your-secret-key-change-in-production
NODE_ENV=development
```

## Database

SQLite database is automatically created in `/database/habit_tracker.db`

### Schema

- **users**: Stores user credentials
- **habits**: User's habit definitions
- **logs**: Daily mood and journal entries
- **completions**: Tracks habit completions per date

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user

### Habits
- `GET /api/habits` - Get all habits
- `POST /api/habits` - Add new habit
- `DELETE /api/habits/:id` - Delete habit

### Logs & Completions
- `POST /api/logs/toggle` - Toggle habit completion
- `GET /api/logs/:logDate` - Get completions for a date
- `POST /api/logs/save` - Save mood and journal
- `GET /api/logs/details/:logDate` - Get mood and journal
- `GET /api/logs` - Get all logs
- `GET /api/stats` - Get user statistics

All endpoints (except auth) require JWT token in Authorization header:
```
Authorization: Bearer <token>
```
