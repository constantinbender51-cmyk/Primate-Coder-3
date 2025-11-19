const express = require('express');
const { Octokit } = require('octokit');
const router = express.Router();

const octokit = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN
});

const owner = process.env.GITHUB_REPO_OWNER;
const repo = process.env.GITHUB_REPO_NAME;

// Get file tree structure
router.get('/tree', async (req, res) => {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: ''
    });

    const files = await processDirectory(response.data);
    res.json(files);
  } catch (error) {
    if (error.status === 404) {
      // Repository is empty - return empty array
      res.json([]);
    } else {
      console.error('GitHub tree error:', error);
      res.status(500).json({ 
        error: 'Failed to get file tree',
        details: error.response?.data || error.message
      });
    }
  }
});

// Get specific file content
router.get('/content/:path(*)', async (req, res) => {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: req.params.path
    });

    const content = Buffer.from(response.data.content, 'base64').toString();
    res.json({
      content: content,
      path: req.params.path,
      size: response.data.size
    });
  } catch (error) {
    if (error.status === 404) {
      // File doesn't exist
      res.status(404).json({ 
        error: 'File not found',
        path: req.params.path
      });
    } else {
      console.error('GitHub content error:', error);
      res.status(500).json({ 
        error: 'Failed to get file content',
        details: error.response?.data || error.message
      });
    }
  }
});

// Check if repo exists and is accessible
router.get('/repo-status', async (req, res) => {
  try {
    const response = await octokit.rest.repos.get({
      owner,
      repo
    });
    
    res.json({
      exists: true,
      name: response.data.name,
      full_name: response.data.full_name,
      empty: response.data.size === 0, // GitHub indicates empty repos with size 0
      html_url: response.data.html_url
    });
  } catch (error) {
    if (error.status === 404) {
      res.status(404).json({
        exists: false,
        error: 'Repository not found or inaccessible'
      });
    } else {
      res.status(500).json({
        error: 'Failed to check repository',
        details: error.response?.data || error.message
      });
    }
  }
});

// Create initial file in empty repository
router.post('/init', async (req, res) => {
  try {
    const { filename, content } = req.body;
    
    const commitResult = await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filename || 'README.md',
      message: 'Initial commit - AI Code Editor',
      content: Buffer.from(content || '# AI Code Editor Project\n\nThis repository was initialized by the AI Code Editor.').toString('base64')
    });

    res.json({
      success: true,
      file: filename || 'README.md',
      commit: commitResult.data.commit.html_url
    });
  } catch (error) {
    console.error('Failed to initialize repo:', error);
    res.status(500).json({
      error: 'Failed to initialize repository',
      details: error.response?.data || error.message
    });
  }
});

// Helper function to recursively get directory structure
async function processDirectory(items) {
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
          children: await processDirectory(dirResponse.data)
        });
      } catch (error) {
        console.error(`Failed to process directory ${item.path}:`, error);
        // Continue with other files/directories
        result.push({
          name: item.name,
          path: item.path,
          type: 'dir',
          children: [],
          error: true
        });
      }
    } else {
      result.push({
        name: item.name,
        path: item.path,
        type: 'file',
        size: item.size
      });
    }
  }

  return result;
}

module.exports = router;
