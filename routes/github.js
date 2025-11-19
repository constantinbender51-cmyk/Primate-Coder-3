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

    // Sort edits by file and line number (highest first)
    const fileEdits = {};
    
    edits.forEach(edit => {
      if (!fileEdits[edit.file_name]) {
        fileEdits[edit.file_name] = [];
      }
      fileEdits[edit.file_name].push(edit);
    });

    // Process each file
    for (const [filename, fileEditsList] of Object.entries(fileEdits)) {
      // Sort edits for this file by line number (highest first)
      fileEditsList.sort((a, b) => (b.line || 0) - (a.line || 0));
      
      // Get current file content (if file exists)
      let currentContent = '';
      let fileExists = true;
      
      try {
        const fileResponse = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: filename
        });
        currentContent = Buffer.from(fileResponse.data.content, 'base64').toString();
      } catch (error) {
        if (error.status === 404) {
          // File doesn't exist yet - this is OK for new files
          fileExists = false;
          currentContent = '';
        } else {
          throw error;
        }
      }

      let lines = currentContent ? currentContent.split('\n') : [];

      // Apply edits
      for (const edit of fileEditsList) {
        switch (edit.action) {
          case 'write':
            lines = edit.content.split('\n');
            break;

          case 'insert':
            if (edit.line > lines.length) {
              // Pad with empty lines if inserting beyond end
              while (lines.length < edit.line - 1) {
                lines.push('');
              }
              lines.push(edit.content);
            } else {
              lines.splice(edit.line - 1, 0, edit.content);
            }
            break;

          case 'delete':
            // Only delete if the content matches and line exists
            if (lines[edit.line - 1] && lines[edit.line - 1] === edit.content) {
              lines.splice(edit.line - 1, 1);
            } else if (lines[edit.line - 1]) {
              throw new Error(`Delete validation failed at line ${edit.line}. Expected: "${edit.content}", Found: "${lines[edit.line - 1]}"`);
            }
            // If line doesn't exist, just continue silently
            break;
        }
      }

      // Commit changes
      const newContent = lines.join('\n');
      const commitMessage = `AI edit: ${filename} - ${fileEditsList.map(e => `${e.action} at line ${e.line}`).join(', ')}`;

      let commitResult;
      try {
        if (fileExists) {
          // Get file SHA for update
          const existingFile = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: filename
          });

          commitResult = await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: filename,
            message: commitMessage,
            content: Buffer.from(newContent).toString('base64'),
            sha: existingFile.data.sha
          });
        } else {
          // Create new file
          commitResult = await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: filename,
            message: commitMessage,
            content: Buffer.from(newContent).toString('base64')
          });
        }
      } catch (error) {
        console.error('Commit error:', error);
        throw error;
      }

      results.push({
        file: filename,
        success: true,
        commit: commitResult.data.commit.html_url,
        action: fileExists ? 'updated' : 'created'
      });
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error('GitHub API error:', error);
    res.status(500).json({ 
      error: 'Failed to apply edits',
      details: error.response?.data || error.message
    });
  }
});

module.exports = router;
