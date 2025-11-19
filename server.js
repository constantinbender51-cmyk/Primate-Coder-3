const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const deepseekRouter = require('./routes/deepseek');
const githubRouter = require('./routes/github');
const filesRouter = require('./routes/files');
const railwayRouter = require('./routes/railway'); // Add this line

const app = express();
const PORT = process.env.PORT || 3000;

// Simple session middleware
app.use((req, res, next) => {
  const sessionId = req.headers['x-session-id'] || generateSessionId();
  req.sessionId = sessionId;
  res.setHeader('x-session-id', sessionId);
  next();
});

function generateSessionId() {
  return 'session_' + Math.random().toString(36).substr(2, 9);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Routes
app.use('/api/deepseek', deepseekRouter);
app.use('/api/github', githubRouter);
app.use('/api/files', filesRouter);
app.use('/api/railway', railwayRouter); // Add this line

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
