const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const deepseekRouter = require('./routes/deepseek');
const githubRouter = require('./routes/github');
const filesRouter = require('./routes/files');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Routes
app.use('/api/deepseek', deepseekRouter);
app.use('/api/github', githubRouter);
app.use('/api/files', filesRouter);

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
