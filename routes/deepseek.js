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

// Simple function to get file list (no content)
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

// Simple function to get file content if needed
async function getFileContent(filePath) {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath
    });
    return Buffer.from(response.data.content, 'base64').toString();
  } catch (error) {
    return null;
  }
}

router.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;

    // Get simple file list
    const files = await getFileList();
    
    // Build context message
    let contextMessage = '';
    if (files.length === 0) {
      contextMessage = 'The repository is currently empty.';
    } else {
      contextMessage = 'Current files in repository:\n' + 
        files.map(file => `- ${file.type === 'dir' ? '📁' : '📄'} ${file.path}`).join('\n');
      
      // If user is asking about specific files, include their content
      const lowerMessage = message.toLowerCase();
      for (const file of files) {
        if (file.type === 'file' && lowerMessage.includes(file.name.toLowerCase())) {
          const content = await getFileContent(file.path);
          if (content) {
            contextMessage += `\n\nContent of ${file.path}:\n\`\`\`\n${content}\n\`\`\``;
          }
        }
      }
    }

    const userMessageWithContext = `${contextMessage}\n\nUser request: ${message}`;

    const response = await axios.post(
      DEEPSEEK_API_URL,
      {
        model: 'deepseek-chat',
        messages: [
          { 
            role: 'system', 
            content: `You are an AI coding assistant. Respond with JSON for code changes in this format:
{
  "files": [
    {
      "file_name": "path/to/file.js",
      "action": "insert|delete|write", 
      "line": 15,
      "content": "code to insert or delete"
    }
  ]
}
Rules: Use "write" for new files or full replacements, "insert" to add lines, "delete" to remove lines.`
          },
          { role: 'user', content: userMessageWithContext }
        ],
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
    
    // Parse JSON from response
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const edits = JSON.parse(jsonMatch[0]);
        res.json({ 
          message: aiResponse,
          edits: edits.files || []
        });
      } else {
        res.json({ 
          message: aiResponse,
          edits: []
        });
      }
    } catch (parseError) {
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
