const { retrieveRelevantExperience, formatExperienceForPrompt } = require('./retrieval');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Anthropic } = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.text()); // so plain-text body is also accepted

// Serve static files and index.html
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Optional: quick check that key is set (does not call API)
app.get('/api/health', (req, res) => {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  res.json({
    ok: true,
    anthropicKeySet: hasKey,
    message: hasKey ? 'API key is set' : 'ANTHROPIC_API_KEY is missing in .env'
  });
});

// Generate interview questions using Anthropic Claude API (SDK)
app.post('/api/generate-questions', async (req, res) => {
  try {
      const { jobDescription } = req.body;
      
      if (!jobDescription) {
          return res.status(400).json({ error: 'Job description is required' });
      }
      
      console.log('📝 Generating questions for JD...');
      
      // NEW: Retrieve relevant experience
      const relevantExperiences = await retrieveRelevantExperience(jobDescription, 3);
      const experienceContext = formatExperienceForPrompt(relevantExperiences);
      
      console.log('✅ Retrieved relevant experience');
      console.log(experienceContext);
      
      // Enhanced prompt with RAG context
      const prompt = `You are helping me prepare for a Product Manager interview.

JOB DESCRIPTION:
${jobDescription}

${experienceContext}

Generate 5 behavioral interview questions that:
1. Are specific to the requirements in the job description
2. Reference my actual achievements and experience listed above where relevant
3. Use STAR format (Situation, Task, Action, Result)
4. Help me showcase the most relevant accomplishments for this role
5. Are not generic ("Tell me about yourself" type questions)

IMPORTANT: Make the questions SPECIFIC to both the job requirements AND my background.
For example, if the job requires AI experience and I built an AI system, ask about that specific system.

Format as a numbered list (1-5).`;

      // Call Claude
      const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1500,
          messages: [{
              role: 'user',
              content: prompt
          }]
      });
      
      const text = response.content[0].text;
      const questions = text
        .split('\n')
        .map((q) => q.replace(/^\d+[\.\)]\s*/, '').trim())
        .filter((q) => q.length > 0)
        .slice(0, 5);

      res.json({ 
          questions,
          relevantExperiences: relevantExperiences.map(exp => ({
              role: exp.role,
              company: exp.company,
              score: exp.score
          }))
      });
      
  } catch (error) {
      console.error('Error generating questions:', error);
      res.status(500).json({ error: 'Failed to generate questions' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
