import express from 'express';
import cors from 'cors';
import bcryptjs from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db.js';
import { authMiddleware, generateToken } from './auth.js';
import { body, validationResult } from 'express-validator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from frontend folder
app.use(express.static(path.join(__dirname, '../frontend')));

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

let db;

// Initialize database and start server
async function startServer() {
  try {
    db = await initDb();
    
    // AUTHENTICATION ROUTES
    
    // Register
    app.post('/api/auth/register', 
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

    // HABITS ROUTES

    // Get all habits for user
    app.get('/api/habits', authMiddleware, async (req, res) => {
      try {
        const habits = await db.all(
          'SELECT * FROM habits WHERE user_id = ? ORDER BY created_at',
          [req.userId]
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
      body('name').notEmpty().withMessage('Habit name required'),
      async (req, res) => {
        try {
          const errors = validationResult(req);
          if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
          }

          const { name, icon = '⭐' } = req.body;

          const result = await db.run(
            'INSERT INTO habits (user_id, name, icon) VALUES (?, ?, ?)',
            [req.userId, name, icon]
          );

          res.status(201).json({
            id: result.lastID,
            user_id: req.userId,
            name,
            icon
          });
        } catch (error) {
          console.error('Add habit error:', error);
          res.status(500).json({ error: 'Failed to add habit' });
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
        res.json({ message: 'Habit deleted' });
      } catch (error) {
        console.error('Delete habit error:', error);
        res.status(500).json({ error: 'Failed to delete habit' });
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
          // Create a default completion entry if none exists
          const habits = await db.all('SELECT id FROM habits WHERE user_id = ?', [req.userId]);
          
          await db.run(
            'INSERT INTO logs (user_id, log_date, mood, journal) VALUES (?, ?, ?, ?)',
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
