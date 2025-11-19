const express = require('express');
const { Octokit } = require('octokit');
const router = express.Router();

const octokit = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN
});

const owner = process.env.GITHUB_REPO_OWNER;
const repo = process.env.GITHUB_REPO_NAME;

// Apply edits to GitHub
router.post('/apply-edits', async (req, res) => {
  try {
    const { edits } = req.body;
    const results = [];

    for (const edit of edits) {
      let currentContent = '';
      let fileExists = true;
      
      // Try to get existing file
      try {
        const fileResponse = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: edit.file_name
        });
        currentContent = Buffer.from(fileResponse.data.content, 'base64').toString();
      } catch (error) {
        if (error.status === 404) {
          fileExists = false;
          currentContent = '';
        } else {
          throw error;
        }
      }

      let lines = currentContent.split('\n');
      
      // Apply the edit
      if (edit.action === 'write') {
        lines = edit.content.split('\n');
      } else if (edit.action === 'insert') {
        if (edit.line > lines.length) {
          lines.push(edit.content);
        } else {
          lines.splice(edit.line - 1, 0, edit.content);
        }
      } else if (edit.action === 'delete') {
        if (lines[edit.line - 1] === edit.content) {
          lines.splice(edit.line - 1, 1);
        }
      }

      const newContent = lines.join('\n');
      const commitMessage = `AI: ${edit.action} ${edit.file_name} line ${edit.line}`;

      try {
        if (fileExists) {
          const existingFile = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: edit.file_name
          });

          await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: edit.file_name,
            message: commitMessage,
            content: Buffer.from(newContent).toString('base64'),
            sha: existingFile.data.sha
          });
        } else {
          await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: edit.file_name,
            message: commitMessage,
            content: Buffer.from(newContent).toString('base64')
          });
        }

        results.push({ file: edit.file_name, success: true });
      } catch (error) {
        throw error;
      }
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error('GitHub API error:', error);
    res.status(500).json({ error: 'Failed to apply edits' });
  }
});

module.exports = router;
