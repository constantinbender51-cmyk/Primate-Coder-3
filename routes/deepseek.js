const express = require('express');
const axios = require('axios');
const { Octokit } = require('octokit');
const router = express.Router();

const octokit = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN
});

const owner = process.env.GITHUB_REPO_OWNER;
const repo = process.env.GITHUB_REPO_NAME;

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

// Memory storage (in production, use Redis or database)
const conversationMemory = new Map();

// Simple function to get file list
async function getFileList() {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: ''
    });
    return response.data.map(item => ({
      name: item.name,
      path: item.path,
      type: item.type
    }));
  } catch (error) {
    if (error.status === 404) {
      return []; // Empty repository
    }
    throw error;
  }
}

// Get conversation history for a session
function getConversationHistory(sessionId, maxMessages = 10) {
  if (!conversationMemory.has(sessionId)) {
    conversationMemory.set(sessionId, { messages: [] });
  }
  
  const session = conversationMemory.get(sessionId);
  // Return last N messages to stay within token limits
  return session.messages.slice(-maxMessages);
}

// Add message to conversation history
function addMessageToHistory(sessionId, role, content) {
  if (!conversationMemory.has(sessionId)) {
    conversationMemory.set(sessionId, { messages: [] });
  }
  
  const session = conversationMemory.get(sessionId);
  session.messages.push({
    role,
    content,
    timestamp: Date.now()
  });
  
  // Keep only last 20 messages to prevent memory issues
  if (session.messages.length > 20) {
    session.messages = session.messages.slice(-20);
  }
}

router.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const sessionId = req.sessionId;

    // Get conversation history
    const history = getConversationHistory(sessionId);
    
    // Get current file list for context
    const files = await getFileList();
    
    // Build context message
    let contextMessage = '';
    if (files.length === 0) {
      contextMessage = 'The repository is currently empty.';
    } else {
      contextMessage = 'Current files in repository:\n' + 
        files.map(file => `- ${file.type === 'dir' ? '📁' : '📄'} ${file.path}`).join('\n');
    }

    // Prepare messages for DeepSeek
    const messages = [
      { 
        role: 'system', 
        content: `You are an AI coding assistant with memory of this conversation. 
        
CONTEXT:
${contextMessage}

CONVERSATION HISTORY:
You have been discussing the codebase with the user. Reference previous work when appropriate.

RESPONSE FORMAT:
Respond with JSON for code changes in this format:
{
  "files": [
    {
      "file_name": "path/to/file.js",
      "action": "insert|delete|write|delete_file", 
      "line": 15,
      "content": "code to insert or delete"
    }
  ]
}

RULES:
- Use "write" for new files or full replacements
- Use "insert" to add lines at specific positions  
- Use "delete" to remove specific lines (content must match exactly)
- Use "delete_file" to completely remove files from repository
- For file deletion, only include file_name and action, line and content are not needed
- Always include line numbers for insert/delete operations`
      }
    ];

    // Add conversation history
    history.forEach(msg => {
      messages.push({
        role: msg.role === 'ai' ? 'assistant' : 'user',
        content: msg.content
      });
    });

    // Add current user message
    messages.push({
      role: 'user',
      content: message
    });

    const response = await axios.post(
      DEEPSEEK_API_URL,
      {
        model: 'deepseek-chat',
        messages: messages,
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const aiResponse = response.data.choices[0].message.content;
    
    // Add user message to history
    addMessageToHistory(sessionId, 'user', message);
    
    // Parse JSON from response and add AI response to history
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const edits = JSON.parse(jsonMatch[0]);
        
        // Add AI response to history
        addMessageToHistory(sessionId, 'ai', aiResponse);
        
        res.json({ 
          message: aiResponse,
          edits: edits.files || []
        });
      } else {
        // Add AI response to history even without edits
        addMessageToHistory(sessionId, 'ai', aiResponse);
        
        res.json({ 
          message: aiResponse,
          edits: []
        });
      }
    } catch (parseError) {
      // Add AI response to history even if JSON parsing fails
      addMessageToHistory(sessionId, 'ai', aiResponse);
      
      res.json({ 
        message: aiResponse,
        edits: []
      });
    }
  } catch (error) {
    console.error('DeepSeek API error:', error);
    res.status(500).json({ 
      error: 'Failed to get AI response'
    });
  }
});

// Debug endpoint to see conversation history
router.get('/history/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const history = getConversationHistory(sessionId, 50); // Get more for debugging
  res.json(history);
});

module.exports = router;
