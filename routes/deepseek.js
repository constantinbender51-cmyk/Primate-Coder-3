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

// Helper function to get repository structure and contents
async function getRepoContext() {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: ''
    });

    const files = await processDirectoryForContext(response.data);
    return files;
  } catch (error) {
    if (error.status === 404) {
      return []; // Empty repository
    }
    throw error;
  }
}

// Recursively process directory for context
async function processDirectoryForContext(items, path = '') {
  const result = [];

  for (const item of items) {
    if (item.type === 'dir') {
      try {
        const dirResponse = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: item.path
        });
        
        const children = await processDirectoryForContext(dirResponse.data, item.path);
        result.push({
          name: item.name,
          path: item.path,
          type: 'dir',
          children: children
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
      // Get file content for context
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

// Format repository context for the prompt
function formatRepoContext(files, indent = 0) {
  let result = '';
  const spaces = '  '.repeat(indent);
  
  files.forEach(file => {
    if (file.type === 'dir') {
      result += `${spaces}📁 ${file.name}/\n`;
      if (file.children && file.children.length > 0) {
        result += formatRepoContext(file.children, indent + 1);
      }
    } else {
      result += `${spaces}📄 ${file.name}\n`;
      if (file.content) {
        // Include file content (truncate very long files)
        const maxLines = 50;
        const lines = file.content.split('\n');
        const content = lines.length > maxLines 
          ? lines.slice(0, maxLines).join('\n') + `\n// ... and ${lines.length - maxLines} more lines`
          : file.content;
          
        result += `${spaces}--- START ${file.name} ---\n`;
        result += content + '\n';
        result += `${spaces}--- END ${file.name} ---\n\n`;
      }
    }
  });
  
  return result;
}

const SYSTEM_PROMPT = `You are an AI coding assistant that can edit code in a GitHub repository. 

CURRENT REPOSITORY STRUCTURE AND CONTENTS:
{REPO_CONTEXT}

IMPORTANT INSTRUCTIONS:
1. When providing code changes, respond with JSON in this exact format:
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

2. RULES FOR EDITING:
- For "insert": add content at specified line number
- For "delete": remove content starting at line number (content must match exactly)
- For "write": replace entire file with content
- Always include line numbers based on the current file content shown above
- Process edits from highest to lowest line numbers
- For same line: delete before insert
- You can create new files by using "write" action on non-existent files

3. CONTEXT AWARENESS:
- Reference existing files and code shown above
- Maintain consistency with the existing codebase
- Follow the same coding style and patterns
- Only modify what's necessary to achieve the user's request

4. RESPONSE FORMAT:
- First, provide a natural language explanation of your changes
- Then, include the JSON with the exact edits
- The JSON must be valid and properly formatted`;

router.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;

    // Get current repository context
    const repoContext = await getRepoContext();
    const formattedContext = formatRepoContext(repoContext);
    
    const dynamicSystemPrompt = SYSTEM_PROMPT.replace('{REPO_CONTEXT}', formattedContext || 'Repository is empty. You can create new files.');

    const response = await axios.post(
      DEEPSEEK_API_URL,
      {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: dynamicSystemPrompt },
          { role: 'user', content: message }
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
    
    // Try to parse JSON from response
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
    console.error('DeepSeek API error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to get AI response',
      details: error.response?.data || error.message
    });
  }
});

module.exports = router;
