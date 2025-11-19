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

// Get repository structure WITH content
async function getRepoWithContent() {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: ''
    });
    return await processDirectoryWithContent(response.data);
  } catch (error) {
    if (error.status === 404) {
      return []; // Empty repository
    }
    throw error;
  }
}

// Recursively process directory and get file contents
async function processDirectoryWithContent(items) {
  const result = [];

  for (const item of items) {
    if (item.type === 'dir') {
      try {
        const dirResponse = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: item.path
        });
        
        result.push({
          name: item.name,
          path: item.path,
          type: 'dir',
          children: await processDirectoryWithContent(dirResponse.data)
        });
      } catch (error) {
        console.error(`Failed to process directory ${item.path}:`, error);
        result.push({
          name: item.name,
          path: item.path,
          type: 'dir',
          children: [],
          error: true
        });
      }
    } else {
      // Get file content
      try {
        const fileResponse = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: item.path
        });
        
        const content = Buffer.from(fileResponse.data.content, 'base64').toString();
        result.push({
          name: item.name,
          path: item.path,
          type: 'file',
          content: content,
          size: item.size
        });
      } catch (error) {
        console.error(`Failed to get content for ${item.path}:`, error);
        result.push({
          name: item.name,
          path: item.path,
          type: 'file',
          content: null,
          error: true
        });
      }
    }
  }

  return result;
}

// Format repository context with file contents
function formatRepoContext(files) {
  if (files.length === 0) {
    return 'The repository is currently empty.';
  }

  let result = 'Current repository contents:\n\n';
  
  function processFiles(fileList, indent = 0) {
    const spaces = '  '.repeat(indent);
    
    fileList.forEach(file => {
      if (file.type === 'dir') {
        result += `${spaces}📁 ${file.name}/\n`;
        if (file.children && file.children.length > 0) {
          processFiles(file.children, indent + 1);
        }
      } else {
        result += `${spaces}📄 ${file.name}\n`;
        if (file.content) {
          // Include file content with line numbers
          const lines = file.content.split('\n');
          result += `${spaces}----------------------------------------\n`;
          lines.forEach((line, index) => {
            result += `${spaces}${(index + 1).toString().padStart(3)}: ${line}\n`;
          });
          result += `${spaces}----------------------------------------\n\n`;
        }
      }
    });
  }
  
  processFiles(files);
  return result;
}

// Get conversation history for a session
function getConversationHistory(sessionId, maxMessages = 10) {
  if (!conversationMemory.has(sessionId)) {
    conversationMemory.set(sessionId, { messages: [] });
  }
  
  const session = conversationMemory.get(sessionId);
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
    
    // Get current repository WITH content
    const repoContents = await getRepoWithContent();
    const context = formatRepoContext(repoContents);

    // Prepare messages for DeepSeek
    const messages = [
      { 
        role: 'system', 
        content: `You are an AI coding assistant with memory of this conversation. 
        
CURRENT CODEBASE:
${context}

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
- Always include line numbers for insert/delete operations
- Reference the actual file contents above to ensure your edits are accurate`
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

module.exports = router;
