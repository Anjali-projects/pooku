import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import bcryptjs from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db.js';
import { authMiddleware, generateToken, COOKIE_OPTIONS } from './auth.js';
import { body, validationResult } from 'express-validator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const allowedOrigins = (process.env.CORS_ORIGINS || `http://localhost:${PORT}`)
  .split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (same-origin, curl, mobile apps)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(cookieParser());
app.use(express.json());

// Rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // 15 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many attempts. Please try again in 15 minutes.' }
});

// Serve static files from frontend folder
app.use(express.static(path.join(__dirname, '../frontend')));

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

let db;

// Standardized API response helpers
function successResponse(data = {}, message = 'OK') {
  return { success: true, message, ...data };
}

function errorResponse(message) {
  return { success: false, error: message };
}

// Initialize database and start server
async function startServer() {
  try {
    db = await initDb();
    
    // AUTHENTICATION ROUTES
    
    // Register
    app.post('/api/auth/register', 
      authLimiter,
      body('username').isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
      body('email').isEmail().withMessage('Valid email required'),
      body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
      async (req, res) => {
        try {
          const errors = validationResult(req);
          if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
          }

          const { username, email, password } = req.body;

          // Check if user exists
          const existing = await db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
          if (existing) {
            return res.status(400).json({ error: 'Username or email already exists' });
          }

          // Hash password
          const hashedPassword = await bcryptjs.hash(password, 10);

          // Create user
          const result = await db.run(
            'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
            [username, email, hashedPassword]
          );

          const userId = result.lastID;
          
          // Create default habits for new user
          const defaultHabits = [
            { name: 'Workout', icon: '🏋️' },
            { name: '3 ltrs of water', icon: '💧' },
            { name: 'Face exercises', icon: '🧘' },
            { name: '8k steps', icon: '🚶' },
            { name: 'Drawing', icon: '🎨' },
            { name: '8hrs of sleep', icon: '💤' }
          ];

          for (const habit of defaultHabits) {
            await db.run(
              'INSERT INTO habits (user_id, name, icon) VALUES (?, ?, ?)',
              [userId, habit.name, habit.icon]
            );
          }

          const token = generateToken(userId);
          res.cookie('token', token, COOKIE_OPTIONS);
          res.status(201).json({ 
            message: 'User registered successfully',
            userId,
            token,
            username
          });
        } catch (error) {
          console.error('Register error:', error);
          res.status(500).json({ error: 'Registration failed' });
        }
      }
    );

    // Login
    app.post('/api/auth/login',
      authLimiter,
      body('username').notEmpty().withMessage('Username required'),
      body('password').notEmpty().withMessage('Password required'),
      async (req, res) => {
        try {
          const errors = validationResult(req);
          if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
          }

          const { username, password } = req.body;

          const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
          if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
          }

          const validPassword = await bcryptjs.compare(password, user.password);
          if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
          }

          const token = generateToken(user.id);
          res.cookie('token', token, COOKIE_OPTIONS);
          res.json({ 
            message: 'Login successful',
            userId: user.id,
            token,
            username: user.username
          });
        } catch (error) {
          console.error('Login error:', error);
          res.status(500).json({ error: 'Login failed' });
        }
      }
    );

    // Logout (clear cookie)
    app.post('/api/auth/logout', (req, res) => {
      res.clearCookie('token', { path: '/' });
      res.json({ message: 'Logged out' });
    });

    // HABITS ROUTES

    // Get all habits for user
    app.get('/api/habits', authMiddleware, async (req, res) => {
      try {
        const showArchived = req.query.archived === '1';
        const habits = await db.all(
          'SELECT * FROM habits WHERE user_id = ? AND archived = ? ORDER BY created_at',
          [req.userId, showArchived ? 1 : 0]
        );
        res.json(habits);
      } catch (error) {
        console.error('Get habits error:', error);
        res.status(500).json({ error: 'Failed to fetch habits' });
      }
    });

    // Add new habit
    app.post('/api/habits',
      authMiddleware,
      body('name').notEmpty().withMessage('Habit name required').isLength({ max: 50 }).withMessage('Habit name too long (max 50 chars)'),
      async (req, res) => {
        try {
          const errors = validationResult(req);
          if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
          }

          const { name, icon = '⭐', frequency = 'daily', category = '', my_why = '' } = req.body;
          const validFreqs = ['daily', 'weekdays', 'weekends', 'weekly', '3x_week'];
          const freq = validFreqs.includes(frequency) ? frequency : 'daily';

          const result = await db.run(
            'INSERT INTO habits (user_id, name, icon, frequency, category, my_why) VALUES (?, ?, ?, ?, ?, ?)',
            [req.userId, name, icon, freq, (category || '').slice(0, 30), (my_why || '').slice(0, 200)]
          );

          res.status(201).json({
            id: result.lastID,
            user_id: req.userId,
            name,
            icon,
            frequency: freq,
            category: category || '',
            my_why: my_why || ''
          });
        } catch (error) {
          console.error('Add habit error:', error);
          res.status(500).json(errorResponse('Failed to add habit'));
        }
      }
    );

    // Delete habit
    app.delete('/api/habits/:id', authMiddleware, async (req, res) => {
      try {
        const { id } = req.params;

        // Verify habit belongs to user
        const habit = await db.get('SELECT * FROM habits WHERE id = ? AND user_id = ?', [id, req.userId]);
        if (!habit) {
          return res.status(404).json({ error: 'Habit not found' });
        }

        await db.run('DELETE FROM habits WHERE id = ?', [id]);
        res.json(successResponse({}, 'Habit deleted'));
      } catch (error) {
        console.error('Delete habit error:', error);
        res.status(500).json(errorResponse('Failed to delete habit'));
      }
    });

    // Update habit name/icon
    app.put('/api/habits/:id', authMiddleware, async (req, res) => {
      try {
        const { id } = req.params;
        const { name, icon } = req.body;

        if (!name || !name.trim()) {
          return res.status(400).json({ error: 'Habit name required' });
        }

        const habit = await db.get('SELECT * FROM habits WHERE id = ? AND user_id = ?', [id, req.userId]);
        if (!habit) {
          return res.status(404).json({ error: 'Habit not found' });
        }

        await db.run(
          'UPDATE habits SET name = ?, icon = ? WHERE id = ? AND user_id = ?',
          [name.trim(), icon || habit.icon, id, req.userId]
        );

        res.json(successResponse({ id: Number(id), name: name.trim(), icon: icon || habit.icon }, 'Habit updated'));
      } catch (error) {
        console.error('Update habit error:', error);
        res.status(500).json(errorResponse('Failed to update habit'));
      }
    });

    // Archive / Restore habit
    app.patch('/api/habits/:id/archive', authMiddleware, async (req, res) => {
      try {
        const { id } = req.params;
        const { archived } = req.body;

        const habit = await db.get('SELECT * FROM habits WHERE id = ? AND user_id = ?', [id, req.userId]);
        if (!habit) {
          return res.status(404).json({ error: 'Habit not found' });
        }

        await db.run(
          'UPDATE habits SET archived = ? WHERE id = ? AND user_id = ?',
          [archived ? 1 : 0, id, req.userId]
        );

        res.json(successResponse({}, archived ? 'Habit archived' : 'Habit restored'));
      } catch (error) {
        console.error('Archive habit error:', error);
        res.status(500).json(errorResponse('Failed to archive habit'));
      }
    });

    // Export user data as JSON (frontend will convert to CSV)
    app.get('/api/export', authMiddleware, async (req, res) => {
      try {
        const habits = await db.all('SELECT id, name, icon, frequency, archived, created_at FROM habits WHERE user_id = ?', [req.userId]);

        const completions = await db.all(
          'SELECT c.habit_id, c.log_date, h.name as habit_name FROM completions c JOIN habits h ON c.habit_id = h.id WHERE c.user_id = ? ORDER BY c.log_date',
          [req.userId]
        );

        const logs = await db.all(
          'SELECT log_date, mood, journal FROM logs WHERE user_id = ? AND habit_id = 0 ORDER BY log_date',
          [req.userId]
        );

        res.json({ habits, completions, logs, exportedAt: new Date().toISOString() });
      } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Failed to export data' });
      }
    });

    // LOGS & COMPLETIONS ROUTES

    // Toggle habit completion for a date
    app.post('/api/logs/toggle', authMiddleware, async (req, res) => {
      try {
        const { habitId, logDate } = req.body;

        if (!habitId || !logDate) {
          return res.status(400).json({ error: 'habitId and logDate required' });
        }

        // Verify habit belongs to user
        const habit = await db.get('SELECT * FROM habits WHERE id = ? AND user_id = ?', [habitId, req.userId]);
        if (!habit) {
          return res.status(404).json({ error: 'Habit not found' });
        }

        // Check if already completed
        const existing = await db.get(
          'SELECT * FROM completions WHERE user_id = ? AND habit_id = ? AND log_date = ?',
          [req.userId, habitId, logDate]
        );

        if (existing) {
          // Remove completion
          await db.run('DELETE FROM completions WHERE id = ?', [existing.id]);
          res.json({ completed: false });
        } else {
          // Add completion
          await db.run(
            'INSERT INTO completions (user_id, habit_id, log_date) VALUES (?, ?, ?)',
            [req.userId, habitId, logDate]
          );
          res.json({ completed: true });
        }
      } catch (error) {
        console.error('Toggle completion error:', error);
        res.status(500).json({ error: 'Failed to toggle completion' });
      }
    });

    // Get completions for a specific date
    app.get('/api/logs/:logDate', authMiddleware, async (req, res) => {
      try {
        const { logDate } = req.params;

        const completions = await db.all(
          'SELECT habit_id FROM completions WHERE user_id = ? AND log_date = ?',
          [req.userId, logDate]
        );

        const habitIds = completions.map(c => c.habit_id);
        res.json({ logDate, completedHabits: habitIds });
      } catch (error) {
        console.error('Get log error:', error);
        res.status(500).json({ error: 'Failed to fetch log' });
      }
    });

    // Save mood and journal for a date
    app.post('/api/logs/save', authMiddleware, async (req, res) => {
      try {
        const { logDate, mood, journal } = req.body;

        if (!logDate) {
          return res.status(400).json({ error: 'logDate required' });
        }

        // Get or create log entry
        let log = await db.get(
          'SELECT * FROM logs WHERE user_id = ? AND log_date = ?',
          [req.userId, logDate]
        );

        if (log) {
          await db.run(
            'UPDATE logs SET mood = ?, journal = ? WHERE id = ?',
            [mood, journal, log.id]
          );
        } else {
          // Use habit_id 0 as sentinel for mood/journal-only entries
          await db.run(
            'INSERT INTO logs (user_id, habit_id, log_date, mood, journal) VALUES (?, 0, ?, ?, ?)',
            [req.userId, logDate, mood, journal]
          );
        }

        res.json({ message: 'Log saved successfully' });
      } catch (error) {
        console.error('Save log error:', error);
        res.status(500).json({ error: 'Failed to save log' });
      }
    });

    // Get mood and journal for a date
    app.get('/api/logs/details/:logDate', authMiddleware, async (req, res) => {
      try {
        const { logDate } = req.params;

        const log = await db.get(
          'SELECT mood, journal FROM logs WHERE user_id = ? AND log_date = ?',
          [req.userId, logDate]
        );

        res.json({ 
          logDate, 
          mood: log?.mood || '', 
          journal: log?.journal || '' 
        });
      } catch (error) {
        console.error('Get log details error:', error);
        res.status(500).json({ error: 'Failed to fetch log details' });
      }
    });

    // Get all logs for user (for progress view)
    app.get('/api/logs', authMiddleware, async (req, res) => {
      try {
        const completions = await db.all(
          `SELECT DISTINCT log_date FROM completions WHERE user_id = ? ORDER BY log_date DESC LIMIT 100`,
          [req.userId]
        );

        const logs = {};
        for (const row of completions) {
          const completed = await db.all(
            'SELECT habit_id FROM completions WHERE user_id = ? AND log_date = ?',
            [req.userId, row.log_date]
          );
          logs[row.log_date] = {
            done: completed.map(c => c.habit_id),
            mood: '',
            journal: ''
          };
        }

        res.json(logs);
      } catch (error) {
        console.error('Get all logs error:', error);
        res.status(500).json({ error: 'Failed to fetch logs' });
      }
    });

    // STATS ROUTE
    app.get('/api/stats', authMiddleware, async (req, res) => {
      try {
        const logs = await db.all(
          'SELECT DISTINCT log_date FROM completions WHERE user_id = ?',
          [req.userId]
        );

        const totalCompleted = await db.get(
          'SELECT COUNT(*) as count FROM completions WHERE user_id = ?',
          [req.userId]
        );

        // Calculate best streak
        let bestStreak = 0;
        const habits = await db.all('SELECT id FROM habits WHERE user_id = ?', [req.userId]);

        for (const habit of habits) {
          const dates = await db.all(
            'SELECT log_date FROM completions WHERE user_id = ? AND habit_id = ? ORDER BY log_date DESC',
            [req.userId, habit.id]
          );

          let streak = 0;
          const today = new Date();
          for (let i = 0; i < 365; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            
            if (dates.some(d => d.log_date === dateStr)) {
              streak++;
            } else {
              break;
            }
          }

          if (streak > bestStreak) bestStreak = streak;
        }

        res.json({
          daysTracked: logs.length,
          totalCompleted: totalCompleted.count,
          bestStreak
        });
      } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
      }
    });

    // ADVANCED ANALYTICS
    app.get('/api/analytics', authMiddleware, async (req, res) => {
      try {
        const habits = await db.all('SELECT * FROM habits WHERE user_id = ? ORDER BY created_at', [req.userId]);
        
        const habitStats = {};
        
        for (const habit of habits) {
          const completions = await db.all(
            'SELECT log_date FROM completions WHERE user_id = ? AND habit_id = ? ORDER BY log_date',
            [req.userId, habit.id]
          );

          // Calculate streak
          let streak = 0;
          const today = new Date();
          for (let i = 0; i < 365; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            if (completions.some(d => d.log_date === dateStr)) {
              streak++;
            } else {
              break;
            }
          }

          // Calculate completion rate
          const last30Days = [];
          const baseDate = new Date();
          for (let i = 29; i >= 0; i--) {
            const date = new Date(baseDate);
            date.setDate(date.getDate() - i);
            last30Days.push(date.toISOString().split('T')[0]);
          }
          const last30Completed = completions.filter(c => last30Days.includes(c.log_date)).length;
          const rate30 = Math.round((last30Completed / 30) * 100);

          habitStats[habit.id] = {
            id: habit.id,
            name: habit.name,
            icon: habit.icon,
            totalCompletions: completions.length,
            currentStreak: streak,
            rate30Day: rate30,
            completions: completions.map(c => c.log_date)
          };
        }

        res.json({ habitStats });
      } catch (error) {
        console.error('Get analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
      }
    });

    // Get calendar data (heat map)
    app.get('/api/calendar', authMiddleware, async (req, res) => {
      try {
        const year = req.query.year || new Date().getFullYear();
        
        const completions = await db.all(
          `SELECT log_date, COUNT(*) as count FROM completions 
           WHERE user_id = ? AND strftime('%Y', log_date) = ? 
           GROUP BY log_date ORDER BY log_date`,
          [req.userId, year]
        );

        const calendarData = {};
        completions.forEach(c => {
          calendarData[c.log_date] = c.count;
        });

        res.json({ year, calendarData });
      } catch (error) {
        console.error('Get calendar error:', error);
        res.status(500).json({ error: 'Failed to fetch calendar' });
      }
    });

    // REMINDERS ROUTES
    app.get('/api/reminders', authMiddleware, async (req, res) => {
      try {
        const reminders = await db.all(
          `SELECT r.*, h.name, h.icon FROM reminders r
           JOIN habits h ON r.habit_id = h.id
           WHERE r.user_id = ? ORDER BY r.habit_id`,
          [req.userId]
        );

        res.json(reminders);
      } catch (error) {
        console.error('Get reminders error:', error);
        res.status(500).json({ error: 'Failed to fetch reminders' });
      }
    });

    app.post('/api/reminders', authMiddleware, async (req, res) => {
      try {
        const { habitId, reminderTime, enabled } = req.body;

        if (!habitId || !reminderTime) {
          return res.status(400).json({ error: 'habitId and reminderTime required' });
        }

        // Verify habit belongs to user
        const habit = await db.get('SELECT * FROM habits WHERE id = ? AND user_id = ?', [habitId, req.userId]);
        if (!habit) {
          return res.status(404).json({ error: 'Habit not found' });
        }

        // Check if reminder exists
        const existing = await db.get(
          'SELECT * FROM reminders WHERE user_id = ? AND habit_id = ?',
          [req.userId, habitId]
        );

        if (existing) {
          await db.run(
            'UPDATE reminders SET reminder_time = ?, enabled = ? WHERE id = ?',
            [reminderTime, enabled ? 1 : 0, existing.id]
          );
        } else {
          await db.run(
            'INSERT INTO reminders (user_id, habit_id, reminder_time, enabled) VALUES (?, ?, ?, ?)',
            [req.userId, habitId, reminderTime, enabled ? 1 : 0]
          );
        }

        res.json({ message: 'Reminder saved successfully' });
      } catch (error) {
        console.error('Save reminder error:', error);
        res.status(500).json({ error: 'Failed to save reminder' });
      }
    });

    app.delete('/api/reminders/:habitId', authMiddleware, async (req, res) => {
      try {
        const { habitId } = req.params;

        await db.run(
          'DELETE FROM reminders WHERE user_id = ? AND habit_id = ?',
          [req.userId, habitId]
        );

        res.json({ message: 'Reminder deleted' });
      } catch (error) {
        console.error('Delete reminder error:', error);
        res.status(500).json({ error: 'Failed to delete reminder' });
      }
    });

    // FRIENDS ROUTES
    app.get('/api/users/search', authMiddleware, async (req, res) => {
      try {
        const { query } = req.query;
        if (!query || query.length < 2) {
          return res.json([]);
        }

        const users = await db.all(
          'SELECT id, username FROM users WHERE username LIKE ? AND id != ? LIMIT 10',
          [`%${query}%`, req.userId]
        );

        res.json(users);
      } catch (error) {
        console.error('Search users error:', error);
        res.status(500).json({ error: 'Failed to search users' });
      }
    });

    app.post('/api/friends/add', authMiddleware, async (req, res) => {
      try {
        const { friendId } = req.body;

        if (!friendId) {
          return res.status(400).json({ error: 'friendId required' });
        }

        // Check if friend exists
        const friend = await db.get('SELECT id FROM users WHERE id = ?', [friendId]);
        if (!friend) {
          return res.status(404).json({ error: 'User not found' });
        }

        // Check if already friends
        const existing = await db.get(
          'SELECT * FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
          [req.userId, friendId, friendId, req.userId]
        );

        if (existing) {
          if (existing.status === 'accepted') {
            return res.status(400).json({ error: 'Already friends' });
          } else {
            return res.status(400).json({ error: 'Request already sent' });
          }
        }

        await db.run(
          'INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)',
          [req.userId, friendId, 'pending']
        );

        res.json({ message: 'Friend request sent' });
      } catch (error) {
        console.error('Add friend error:', error);
        res.status(500).json({ error: 'Failed to add friend' });
      }
    });

    app.get('/api/friends', authMiddleware, async (req, res) => {
      try {
        const friends = await db.all(
          `SELECT u.id, u.username, f.status FROM friends f
           JOIN users u ON (f.friend_id = u.id OR f.user_id = u.id)
           WHERE (f.user_id = ? OR f.friend_id = ?) AND u.id != ?
           ORDER BY f.created_at DESC`,
          [req.userId, req.userId, req.userId]
        );

        res.json(friends);
      } catch (error) {
        console.error('Get friends error:', error);
        res.status(500).json({ error: 'Failed to fetch friends' });
      }
    });

    app.post('/api/friends/accept', authMiddleware, async (req, res) => {
      try {
        const { friendId } = req.body;

        await db.run(
          'UPDATE friends SET status = ? WHERE friend_id = ? AND user_id = ?',
          ['accepted', req.userId, friendId]
        );

        res.json({ message: 'Friend request accepted' });
      } catch (error) {
        console.error('Accept friend error:', error);
        res.status(500).json({ error: 'Failed to accept request' });
      }
    });

    // Decline friend request / Unfriend
    app.delete('/api/friends/:friendId', authMiddleware, async (req, res) => {
      try {
        const { friendId } = req.params;

        await db.run(
          'DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
          [req.userId, friendId, friendId, req.userId]
        );

        // Also delete messages between the two users
        await db.run(
          'DELETE FROM messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)',
          [req.userId, friendId, friendId, req.userId]
        );

        res.json({ message: 'Friend removed' });
      } catch (error) {
        console.error('Remove friend error:', error);
        res.status(500).json({ error: 'Failed to remove friend' });
      }
    });

    app.get('/api/friends/:friendId/progress', authMiddleware, async (req, res) => {
      try {
        const { friendId } = req.params;

        // Check if they're friends
        const friend = await db.get(
          `SELECT * FROM friends WHERE status = 'accepted' AND 
           ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))`,
          [req.userId, friendId, friendId, req.userId]
        );

        if (!friend) {
          return res.status(403).json({ error: 'Not friends' });
        }

        // Get friend's habits and today's progress
        const habits = await db.all(
          'SELECT * FROM habits WHERE user_id = ? ORDER BY created_at',
          [friendId]
        );

        const today = new Date().toISOString().split('T')[0];
        const completions = await db.all(
          'SELECT habit_id FROM completions WHERE user_id = ? AND log_date = ?',
          [friendId, today]
        );

        const completedIds = completions.map(c => c.habit_id);

        res.json({
          habits,
          today,
          completed: completedIds,
          completedCount: completedIds.length
        });
      } catch (error) {
        console.error('Get friend progress error:', error);
        res.status(500).json({ error: 'Failed to fetch friend progress' });
      }
    });

    // MESSAGING ROUTES
    app.post('/api/messages/send', authMiddleware, async (req, res) => {
      try {
        const { receiverId, message } = req.body;

        if (!receiverId || !message) {
          return res.status(400).json({ error: 'receiverId and message required' });
        }

        if (message.length > 500) {
          return res.status(400).json({ error: 'Message too long (max 500 chars)' });
        }

        await db.run(
          'INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)',
          [req.userId, receiverId, message]
        );

        res.json({ message: 'Message sent' });
      } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ error: 'Failed to send message' });
      }
    });

    app.get('/api/messages/:friendId', authMiddleware, async (req, res) => {
      try {
        const { friendId } = req.params;

        const messages = await db.all(
          `SELECT * FROM messages 
           WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
           ORDER BY created_at ASC LIMIT 50`,
          [req.userId, friendId, friendId, req.userId]
        );

        // Mark as read
        await db.run(
          'UPDATE messages SET read_status = 1 WHERE receiver_id = ? AND sender_id = ? AND read_status = 0',
          [req.userId, friendId]
        );

        res.json(messages);
      } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
      }
    });

    // HABIT NOTES ROUTES
    app.post('/api/habit-notes', authMiddleware, async (req, res) => {
      try {
        const { habitId, logDate, note } = req.body;

        if (!habitId || !logDate) {
          return res.status(400).json({ error: 'habitId and logDate required' });
        }

        if (note && note.length > 500) {
          return res.status(400).json({ error: 'Note too long (max 500 chars)' });
        }

        const existing = await db.get(
          'SELECT * FROM habit_notes WHERE user_id = ? AND habit_id = ? AND log_date = ?',
          [req.userId, habitId, logDate]
        );

        if (existing) {
          if (!note || !note.trim()) {
            await db.run('DELETE FROM habit_notes WHERE id = ?', [existing.id]);
          } else {
            await db.run('UPDATE habit_notes SET note = ? WHERE id = ?', [note.trim(), existing.id]);
          }
        } else if (note && note.trim()) {
          await db.run(
            'INSERT INTO habit_notes (user_id, habit_id, log_date, note) VALUES (?, ?, ?, ?)',
            [req.userId, habitId, logDate, note.trim()]
          );
        }

        res.json(successResponse({}, 'Note saved'));
      } catch (error) {
        console.error('Save habit note error:', error);
        res.status(500).json(errorResponse('Failed to save note'));
      }
    });

    app.get('/api/habit-notes/:logDate', authMiddleware, async (req, res) => {
      try {
        const { logDate } = req.params;
        const notes = await db.all(
          'SELECT habit_id, note FROM habit_notes WHERE user_id = ? AND log_date = ?',
          [req.userId, logDate]
        );

        const notesMap = {};
        notes.forEach(n => { notesMap[n.habit_id] = n.note; });
        res.json(notesMap);
      } catch (error) {
        console.error('Get habit notes error:', error);
        res.status(500).json(errorResponse('Failed to fetch notes'));
      }
    });

    // PROFILE ROUTES
    app.get('/api/auth/profile', authMiddleware, async (req, res) => {
      try {
        const user = await db.get('SELECT id, username, email FROM users WHERE id = ?', [req.userId]);
        if (!user) return res.status(404).json(errorResponse('User not found'));
        res.json(user);
      } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json(errorResponse('Failed to fetch profile'));
      }
    });

    app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
      try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
          return res.status(400).json(errorResponse('Both passwords required'));
        }
        if (newPassword.length < 6) {
          return res.status(400).json(errorResponse('New password must be at least 6 characters'));
        }

        const user = await db.get('SELECT * FROM users WHERE id = ?', [req.userId]);
        const valid = await bcryptjs.compare(currentPassword, user.password);
        if (!valid) {
          return res.status(401).json(errorResponse('Current password is incorrect'));
        }

        const hashed = await bcryptjs.hash(newPassword, 10);
        await db.run('UPDATE users SET password = ? WHERE id = ?', [hashed, req.userId]);
        res.json(successResponse({}, 'Password updated'));
      } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json(errorResponse('Failed to change password'));
      }
    });

    // FRIEND COMPARISON
    app.get('/api/friends/:friendId/compare', authMiddleware, async (req, res) => {
      try {
        const { friendId } = req.params;
        const range = req.query.range || 'week';

        // Verify friendship
        const friend = await db.get(
          `SELECT * FROM friends WHERE status = 'accepted' AND 
           ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))`,
          [req.userId, friendId, friendId, req.userId]
        );
        if (!friend) return res.status(403).json(errorResponse('Not friends'));

        const days = range === 'month' ? 30 : 7;
        const labels = [];
        const myData = [];
        const friendData = [];

        for (let i = days - 1; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().slice(0, 10);
          labels.push(days <= 7 ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()] : `${d.getMonth()+1}/${d.getDate()}`);

          const myCount = await db.get(
            'SELECT COUNT(*) as c FROM completions WHERE user_id = ? AND log_date = ?',
            [req.userId, dateStr]
          );
          const friendCount = await db.get(
            'SELECT COUNT(*) as c FROM completions WHERE user_id = ? AND log_date = ?',
            [friendId, dateStr]
          );
          myData.push(myCount?.c || 0);
          friendData.push(friendCount?.c || 0);
        }

        res.json({ labels, myData, friendData });
      } catch (error) {
        console.error('Friend compare error:', error);
        res.status(500).json(errorResponse('Failed to load comparison'));
      }
    });

    // TYPING INDICATOR (in-memory, no DB)
    const typingStatus = {}; // { recipientId: { senderId: timestamp } }

    app.post('/api/messages/typing', authMiddleware, (req, res) => {
      const { receiverId } = req.body;
      if (!receiverId) return res.status(400).json(errorResponse('receiverId required'));
      if (!typingStatus[receiverId]) typingStatus[receiverId] = {};
      typingStatus[receiverId][req.userId] = Date.now();
      res.json({ ok: true });
    });

    // Patch the messages GET to include typing status
    // We already have a messages route, so we'll add a separate typing-check endpoint
    app.get('/api/messages/typing/:friendId', authMiddleware, (req, res) => {
      const { friendId } = req.params;
      const status = typingStatus[req.userId]?.[friendId];
      const isTyping = status && (Date.now() - status) < 3000;
      res.json({ typing: !!isTyping });
    });

    // ============ DAILY CHECK-IN STREAK (#15) ============
    app.post('/api/check-in', authMiddleware, async (req, res) => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        await db.run(
          'INSERT OR IGNORE INTO check_ins (user_id, check_date) VALUES (?, ?)',
          [req.userId, today]
        );
        res.json(successResponse({}, 'Checked in'));
      } catch (error) {
        console.error('Check-in error:', error);
        res.status(500).json(errorResponse('Failed to check in'));
      }
    });

    app.get('/api/check-in/streak', authMiddleware, async (req, res) => {
      try {
        const rows = await db.all(
          'SELECT check_date FROM check_ins WHERE user_id = ? ORDER BY check_date DESC',
          [req.userId]
        );
        let streak = 0;
        const today = new Date();
        for (let i = 0; i < rows.length; i++) {
          const expected = new Date(today);
          expected.setDate(today.getDate() - i);
          const expectedStr = expected.toISOString().slice(0, 10);
          if (rows[i].check_date === expectedStr) {
            streak++;
          } else {
            break;
          }
        }
        const totalDays = rows.length;
        res.json({ streak, totalDays, firstDate: rows.length > 0 ? rows[rows.length - 1].check_date : null });
      } catch (error) {
        console.error('Check-in streak error:', error);
        res.status(500).json(errorResponse('Failed to get streak'));
      }
    });

    // ============ HABIT CATEGORIES & MY WHY (#16, #18) ============
    app.patch('/api/habits/:id/details', authMiddleware, async (req, res) => {
      try {
        const { id } = req.params;
        const { category, my_why } = req.body;
        const habit = await db.get('SELECT * FROM habits WHERE id = ? AND user_id = ?', [id, req.userId]);
        if (!habit) return res.status(404).json(errorResponse('Habit not found'));

        if (category !== undefined) {
          await db.run('UPDATE habits SET category = ? WHERE id = ?', [category.slice(0, 30), id]);
        }
        if (my_why !== undefined) {
          await db.run('UPDATE habits SET my_why = ? WHERE id = ?', [my_why.slice(0, 200), id]);
        }
        res.json(successResponse({}, 'Updated'));
      } catch (error) {
        console.error('Habit details error:', error);
        res.status(500).json(errorResponse('Failed to update habit'));
      }
    });

    // ============ WEEKLY FRIEND LEADERBOARD (#17) ============
    app.get('/api/friends/leaderboard', authMiddleware, async (req, res) => {
      try {
        // Get accepted friends
        const friends = await db.all(
          `SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END AS fid
           FROM friends WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'`,
          [req.userId, req.userId, req.userId]
        );
        const friendIds = friends.map(f => f.fid);
        friendIds.push(req.userId); // Include self

        // Last 7 days
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const weekStr = weekAgo.toISOString().slice(0, 10);

        const board = [];
        for (const uid of friendIds) {
          const user = await db.get('SELECT id, username FROM users WHERE id = ?', [uid]);
          if (!user) continue;
          const completions = await db.get(
            'SELECT COUNT(*) as cnt FROM completions WHERE user_id = ? AND log_date >= ?',
            [uid, weekStr]
          );
          const daysActive = await db.get(
            'SELECT COUNT(DISTINCT log_date) as cnt FROM completions WHERE user_id = ? AND log_date >= ?',
            [uid, weekStr]
          );
          board.push({
            userId: uid,
            username: user.username,
            completions: completions.cnt,
            daysActive: daysActive.cnt,
            isMe: uid === req.userId
          });
        }
        board.sort((a, b) => b.completions - a.completions);
        res.json(board);
      } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json(errorResponse('Failed to get leaderboard'));
      }
    });

    // ============ WEEKLY REFLECTION (#20) ============
    app.post('/api/reflections', authMiddleware, async (req, res) => {
      try {
        const { weekStart, wentWell, wasHard, focusNext } = req.body;
        if (!weekStart) return res.status(400).json(errorResponse('weekStart required'));
        await db.run(
          `INSERT INTO weekly_reflections (user_id, week_start, went_well, was_hard, focus_next)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, week_start) DO UPDATE SET went_well=excluded.went_well, was_hard=excluded.was_hard, focus_next=excluded.focus_next`,
          [req.userId, weekStart, (wentWell || '').slice(0, 500), (wasHard || '').slice(0, 500), (focusNext || '').slice(0, 500)]
        );
        res.json(successResponse({}, 'Reflection saved'));
      } catch (error) {
        console.error('Reflection save error:', error);
        res.status(500).json(errorResponse('Failed to save reflection'));
      }
    });

    app.get('/api/reflections/:weekStart', authMiddleware, async (req, res) => {
      try {
        const row = await db.get(
          'SELECT * FROM weekly_reflections WHERE user_id = ? AND week_start = ?',
          [req.userId, req.params.weekStart]
        );
        res.json(row || { went_well: '', was_hard: '', focus_next: '' });
      } catch (error) {
        console.error('Reflection get error:', error);
        res.status(500).json(errorResponse('Failed to get reflection'));
      }
    });

    // ============ SSE FOR CHAT (#21) ============
    const sseClients = new Map(); // userId -> Set of response objects

    app.get('/api/messages/stream', authMiddleware, (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write('data: connected\n\n');

      if (!sseClients.has(req.userId)) sseClients.set(req.userId, new Set());
      sseClients.get(req.userId).add(res);

      req.on('close', () => {
        const clients = sseClients.get(req.userId);
        if (clients) {
          clients.delete(res);
          if (clients.size === 0) sseClients.delete(req.userId);
        }
      });
    });

    function notifySSE(userId, event, data) {
      const clients = sseClients.get(userId);
      if (clients) {
        const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        clients.forEach(res => res.write(msg));
      }
    }

    // Update send message to push via SSE
    const origSendHandler = app._router.stack;
    app.post('/api/messages/send-sse', authMiddleware, async (req, res) => {
      try {
        const { receiverId, message } = req.body;
        if (!receiverId || !message || !message.trim()) {
          return res.status(400).json(errorResponse('receiverId and message required'));
        }
        // Verify friendship
        const friendship = await db.get(
          `SELECT * FROM friends WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) AND status = 'accepted'`,
          [req.userId, receiverId, receiverId, req.userId]
        );
        if (!friendship) return res.status(403).json(errorResponse('Not friends'));

        const result = await db.run(
          'INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)',
          [req.userId, receiverId, message.trim().slice(0, 500)]
        );
        const newMsg = {
          id: result.lastID,
          sender_id: req.userId,
          receiver_id: receiverId,
          message: message.trim(),
          read_status: 0,
          created_at: new Date().toISOString()
        };
        // Push to receiver via SSE
        notifySSE(receiverId, 'new-message', newMsg);
        // Also push to sender (for multi-tab sync)
        notifySSE(req.userId, 'new-message', newMsg);

        res.json(newMsg);
      } catch (error) {
        console.error('Send message SSE error:', error);
        res.status(500).json(errorResponse('Failed to send'));
      }
    });

    // ============ HABIT TEMPLATES (#22) ============
    app.get('/api/habit-templates', authMiddleware, (req, res) => {
      const templates = [
        {
          name: 'Morning Routine Starter',
          desc: 'Start your day with intention',
          icon: '🌅',
          habits: [
            { name: 'Wake up early', icon: '☀️', frequency: 'daily' },
            { name: 'Drink water', icon: '💧', frequency: 'daily' },
            { name: 'Stretch / Yoga', icon: '🧘', frequency: 'daily' },
            { name: 'Healthy breakfast', icon: '🥗', frequency: 'daily' },
            { name: 'Plan your day', icon: '✍️', frequency: 'weekdays' }
          ]
        },
        {
          name: 'Fitness Focus',
          desc: 'Build strength and endurance',
          icon: '💪',
          habits: [
            { name: 'Workout', icon: '🏋️', frequency: 'daily' },
            { name: 'Walk 10k steps', icon: '🚶', frequency: 'daily' },
            { name: 'Drink 2L water', icon: '💧', frequency: 'daily' },
            { name: 'Take vitamins', icon: '💊', frequency: 'daily' },
            { name: 'Protein-rich meal', icon: '🍎', frequency: 'daily' }
          ]
        },
        {
          name: 'Mindfulness Pack',
          desc: 'Calm your mind, find your center',
          icon: '🧘',
          habits: [
            { name: 'Meditate 10 mins', icon: '🧘', frequency: 'daily' },
            { name: 'Journal', icon: '✍️', frequency: 'daily' },
            { name: 'Gratitude list', icon: '🌿', frequency: 'daily' },
            { name: 'No phone before bed', icon: '🛏️', frequency: 'daily' },
            { name: 'Read 20 mins', icon: '📚', frequency: 'daily' }
          ]
        },
        {
          name: 'Productivity Pro',
          desc: 'Get more done, stress less',
          icon: '🚀',
          habits: [
            { name: 'Plan top 3 tasks', icon: '✍️', frequency: 'weekdays' },
            { name: 'Deep work block', icon: '💻', frequency: 'weekdays' },
            { name: 'Inbox zero', icon: '📚', frequency: 'weekdays' },
            { name: 'Review the day', icon: '🌿', frequency: 'weekdays' },
            { name: 'Clean workspace', icon: '🧹', frequency: 'weekly' }
          ]
        },
        {
          name: 'Self-Care Sunday',
          desc: 'Recharge and reset weekly',
          icon: '🛁',
          habits: [
            { name: 'Skincare routine', icon: '🧴', frequency: 'daily' },
            { name: 'Cook a nice meal', icon: '🥗', frequency: 'weekends' },
            { name: 'Creative hobby', icon: '🎨', frequency: 'weekends' },
            { name: 'Connect with a friend', icon: '🌊', frequency: 'weekly' },
            { name: 'Early bedtime', icon: '💤', frequency: 'daily' }
          ]
        }
      ];
      res.json(templates);
    });

    app.post('/api/habit-templates/import', authMiddleware, async (req, res) => {
      try {
        const { habits: templateHabits } = req.body;
        if (!templateHabits || !Array.isArray(templateHabits)) {
          return res.status(400).json(errorResponse('habits array required'));
        }
        const added = [];
        for (const h of templateHabits.slice(0, 10)) {
          const name = (h.name || '').slice(0, 50);
          const icon = h.icon || '⭐';
          const freq = ['daily','weekdays','weekends','weekly','3x_week'].includes(h.frequency) ? h.frequency : 'daily';
          if (!name) continue;
          const result = await db.run(
            'INSERT INTO habits (user_id, name, icon, frequency) VALUES (?, ?, ?, ?)',
            [req.userId, name, icon, freq]
          );
          added.push({ id: result.lastID, name, icon, frequency: freq });
        }
        res.json({ added, count: added.length });
      } catch (error) {
        console.error('Template import error:', error);
        res.status(500).json(errorResponse('Failed to import'));
      }
    });

    // ── CHALLENGES (shared 21-day challenges) ──

    // Create a challenge
    app.post('/api/challenges', authMiddleware, async (req, res) => {
      try {
        const { title, description, duration } = req.body;
        if (!title || !title.trim()) return res.status(400).json(errorResponse('Title required'));
        const dur = Math.min(Math.max(parseInt(duration) || 21, 7), 90);
        const startDate = new Date().toISOString().split('T')[0];
        const result = await db.run(
          'INSERT INTO challenges (creator_id, title, description, duration, start_date) VALUES (?,?,?,?,?)',
          [req.userId, title.trim().slice(0, 100), (description || '').slice(0, 300), dur, startDate]
        );
        // Auto-join creator
        await db.run('INSERT INTO challenge_participants (challenge_id, user_id) VALUES (?,?)', [result.lastID, req.userId]);
        res.json(successResponse({ id: result.lastID }));
      } catch (e) { console.error(e); res.status(500).json(errorResponse('Failed to create challenge')); }
    });

    // Get challenges the user is part of (or created by friends)
    app.get('/api/challenges', authMiddleware, async (req, res) => {
      try {
        const challenges = await db.all(`
          SELECT c.*, u.username AS creator_name,
            (SELECT COUNT(*) FROM challenge_participants WHERE challenge_id = c.id) AS participant_count,
            (SELECT COUNT(*) FROM challenge_logs WHERE challenge_id = c.id AND user_id = ?) AS my_completed_days,
            CASE WHEN cp.user_id IS NOT NULL THEN 1 ELSE 0 END AS joined
          FROM challenges c
          JOIN users u ON c.creator_id = u.id
          LEFT JOIN challenge_participants cp ON cp.challenge_id = c.id AND cp.user_id = ?
          WHERE cp.user_id = ? OR c.creator_id IN (
            SELECT CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
            FROM friends f WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
          )
          ORDER BY c.created_at DESC
        `, [req.userId, req.userId, req.userId, req.userId, req.userId, req.userId]);
        res.json(challenges);
      } catch (e) { console.error(e); res.status(500).json(errorResponse('Failed to load challenges')); }
    });

    // Join a challenge
    app.post('/api/challenges/:id/join', authMiddleware, async (req, res) => {
      try {
        const ch = await db.get('SELECT * FROM challenges WHERE id = ?', [req.params.id]);
        if (!ch) return res.status(404).json(errorResponse('Challenge not found'));
        await db.run('INSERT OR IGNORE INTO challenge_participants (challenge_id, user_id) VALUES (?,?)', [ch.id, req.userId]);
        res.json(successResponse());
      } catch (e) { console.error(e); res.status(500).json(errorResponse('Failed to join')); }
    });

    // Log a day for a challenge
    app.post('/api/challenges/:id/log', authMiddleware, async (req, res) => {
      try {
        const logDate = new Date().toISOString().split('T')[0];
        await db.run('INSERT OR IGNORE INTO challenge_logs (challenge_id, user_id, log_date) VALUES (?,?,?)',
          [req.params.id, req.userId, logDate]);
        res.json(successResponse());
      } catch (e) { console.error(e); res.status(500).json(errorResponse('Failed to log')); }
    });

    // Get challenge progress board
    app.get('/api/challenges/:id/progress', authMiddleware, async (req, res) => {
      try {
        const ch = await db.get('SELECT * FROM challenges WHERE id = ?', [req.params.id]);
        if (!ch) return res.status(404).json(errorResponse('Not found'));
        const participants = await db.all(`
          SELECT u.id, u.username,
            (SELECT COUNT(*) FROM challenge_logs WHERE challenge_id = ? AND user_id = u.id) AS days_done
          FROM challenge_participants cp
          JOIN users u ON cp.user_id = u.id
          WHERE cp.challenge_id = ?
          ORDER BY days_done DESC
        `, [ch.id, ch.id]);
        res.json({ challenge: ch, participants });
      } catch (e) { console.error(e); res.status(500).json(errorResponse('Failed')); }
    });

    // ── TIME CAPSULES ──

    // Create a time capsule
    app.post('/api/time-capsules', authMiddleware, async (req, res) => {
      try {
        const { message, revealIn } = req.body;
        if (!message || !message.trim()) return res.status(400).json(errorResponse('Message required'));
        const days = [30, 90, 365].includes(parseInt(revealIn)) ? parseInt(revealIn) : 30;
        const revealDate = new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
        const result = await db.run(
          'INSERT INTO time_capsules (user_id, message, reveal_date) VALUES (?,?,?)',
          [req.userId, message.trim().slice(0, 2000), revealDate]
        );
        res.json(successResponse({ id: result.lastID, reveal_date: revealDate }));
      } catch (e) { console.error(e); res.status(500).json(errorResponse('Failed to create capsule')); }
    });

    // Get time capsules (revealed ones show message, locked ones show date only)
    app.get('/api/time-capsules', authMiddleware, async (req, res) => {
      try {
        const today = new Date().toISOString().split('T')[0];
        const capsules = await db.all(
          'SELECT id, reveal_date, created_at, CASE WHEN reveal_date <= ? THEN message ELSE NULL END AS message FROM time_capsules WHERE user_id = ? ORDER BY created_at DESC',
          [today, req.userId]
        );
        res.json(capsules);
      } catch (e) { console.error(e); res.status(500).json(errorResponse('Failed to load capsules')); }
    });

    // ── VOICE JOURNALS ──

    // Save voice journal (base64 audio)
    app.post('/api/voice-journal', authMiddleware, async (req, res) => {
      try {
        const { audioData, duration } = req.body;
        if (!audioData) return res.status(400).json(errorResponse('Audio data required'));
        // Limit to ~1MB of base64 data (~750KB audio)
        if (audioData.length > 1048576) return res.status(400).json(errorResponse('Recording too large'));
        const logDate = new Date().toISOString().split('T')[0];
        const dur = Math.min(parseInt(duration) || 0, 30);
        await db.run(
          'INSERT OR REPLACE INTO voice_journals (user_id, log_date, audio_data, duration_secs) VALUES (?,?,?,?)',
          [req.userId, logDate, audioData, dur]
        );
        res.json(successResponse());
      } catch (e) { console.error(e); res.status(500).json(errorResponse('Failed to save voice journal')); }
    });

    // Get voice journal for a date
    app.get('/api/voice-journal/:logDate', authMiddleware, async (req, res) => {
      try {
        const entry = await db.get(
          'SELECT audio_data, duration_secs, created_at FROM voice_journals WHERE user_id = ? AND log_date = ?',
          [req.userId, req.params.logDate]
        );
        res.json(entry || null);
      } catch (e) { console.error(e); res.status(500).json(errorResponse('Failed to load')); }
    });

    // ── MOOD TRENDS ──

    // Get mood history for charting (last N days)
    app.get('/api/mood-trends', authMiddleware, async (req, res) => {
      try {
        const days = Math.min(parseInt(req.query.days) || 30, 365);
        const rows = await db.all(`
          SELECT log_date, mood FROM logs
          WHERE user_id = ? AND habit_id = 0 AND mood IS NOT NULL AND mood != ''
          ORDER BY log_date DESC LIMIT ?
        `, [req.userId, days]);
        // Also get daily completion rates for correlation
        const completionRows = await db.all(`
          SELECT c.log_date, COUNT(*) as completed,
            (SELECT COUNT(*) FROM habits WHERE user_id = ? AND archived = 0) AS total
          FROM completions c
          WHERE c.user_id = ?
          GROUP BY c.log_date
          ORDER BY c.log_date DESC LIMIT ?
        `, [req.userId, req.userId, days]);
        res.json({ moods: rows.reverse(), completions: completionRows.reverse() });
      } catch (e) { console.error(e); res.status(500).json(errorResponse('Failed to load mood trends')); }
    });

    app.listen(PORT, () => {
      console.log(`✓ Server running on http://localhost:${PORT}`);
      console.log(`✓ Frontend available at http://localhost:${PORT}/`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
