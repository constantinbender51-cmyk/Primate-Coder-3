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

    // Group edits by file and sort by line number (highest first for deletes)
    const fileEdits = {};
    
    edits.forEach(edit => {
      if (!fileEdits[edit.file_name]) {
        fileEdits[edit.file_name] = [];
      }
      fileEdits[edit.file_name].push(edit);
    });

    // Process each file
    for (const [filename, fileEditsList] of Object.entries(fileEdits)) {
      let fileExists = true;
      
      // Check if file exists
      try {
        await octokit.rest.repos.getContent({
          owner,
          repo,
          path: filename
        });
      } catch (error) {
        if (error.status === 404) {
          fileExists = false;
        } else {
          throw error;
        }
      }

      // Handle file deletion first
      const deleteFileEdit = fileEditsList.find(edit => edit.action === 'delete_file');
      if (deleteFileEdit) {
        // Handle file deletion
        if (fileExists) {
          const existingFile = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: filename
          });

          await octokit.rest.repos.deleteFile({
            owner,
            repo,
            path: filename,
            message: `AI: delete file ${filename}`,
            sha: existingFile.data.sha
          });
          
          results.push({ file: filename, success: true, action: 'deleted' });
        } else {
          results.push({ file: filename, success: false, error: 'File not found' });
        }
        continue; // Skip other edits for this file
      }

      // Get current file content
      let currentContent = '';
      if (fileExists) {
        const fileResponse = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: filename
        });
        currentContent = Buffer.from(fileResponse.data.content, 'base64').toString();
      }

      let lines = currentContent ? currentContent.split('\n') : [];

      // Sort edits: deletes first (highest line numbers), then other operations
      fileEditsList.sort((a, b) => {
        if (a.action === 'delete' && b.action === 'delete') {
          return b.line - a.line; // Delete highest lines first
        }
        if (a.action === 'delete') return -1; // Deletes before other operations
        if (b.action === 'delete') return 1;
        return 0; // Maintain order for other operations
      });

      // Apply edits in sorted order
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
              console.warn(`Delete validation failed for ${filename} line ${edit.line}. Expected: "${edit.content}", Found: "${lines[edit.line - 1]}"`);
            }
            break;
        }
      }

      // Commit changes
      const newContent = lines.join('\n');
      const commitMessage = `AI: ${filename} - ${fileEditsList.map(e => `${e.action} at line ${e.line}`).join(', ')}`;

      try {
        if (fileExists) {
          // Get file SHA for update
          const existingFile = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: filename
          });

          await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: filename,
            message: commitMessage,
            content: Buffer.from(newContent).toString('base64'),
            sha: existingFile.data.sha
          });
        } else {
          // Create new file
          await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: filename,
            message: commitMessage,
            content: Buffer.from(newContent).toString('base64')
          });
        }

        results.push({ file: filename, success: true, action: 'updated' });
      } catch (error) {
        console.error('Commit error:', error);
        throw error;
      }
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
