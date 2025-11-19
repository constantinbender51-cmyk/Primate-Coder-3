const express = require('express');
const axios = require('axios');
const router = express.Router();

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

const SYSTEM_PROMPT = `You are an AI coding assistant. When providing code changes, respond with JSON in this exact format:

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

Rules:
- For "insert": add content at specified line number
- For "delete": remove content starting at line number (content must match exactly)
- For "write": replace entire file with content (creates file if it doesn't exist)
- Always include line numbers
- Process edits from highest to lowest line numbers
- For same line: delete before insert
`;

router.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;

    const response = await axios.post(
      DEEPSEEK_API_URL,
      {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
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
    console.error('DeepSeek API error:', error);
    res.status(500).json({ 
      error: 'Failed to get AI response'
    });
  }
});

module.exports = router;
