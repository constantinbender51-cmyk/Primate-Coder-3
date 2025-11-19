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
      res.status(500).json({ error: 'Failed to get file tree' });
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
    res.json({ content });
  } catch (error) {
    if (error.status === 404) {
      res.status(404).json({ error: 'File not found' });
    } else {
      res.status(500).json({ error: 'Failed to get file content' });
    }
  }
});

// Helper function to recursively get directory structure
async function processDirectory(items) {
  const result = [];

  for (const item of items) {
    if (item.type === 'dir') {
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
    } else {
      result.push({
        name: item.name,
        path: item.path,
        type: 'file'
      });
    }
  }

  return result;
}

module.exports = router;
