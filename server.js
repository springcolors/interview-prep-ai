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

// Optional: quick check that keys are set (does not call APIs)
app.get('/api/health', (req, res) => {
  const anthropic = !!process.env.ANTHROPIC_API_KEY;
  const openai = !!process.env.OPENAI_API_KEY;
  const pinecone = !!process.env.PINECONE_API_KEY;
  const index = !!process.env.PINECONE_INDEX;
  const ok = anthropic && openai && pinecone && index;
  res.json({
    ok,
    anthropicKeySet: anthropic,
    openaiKeySet: openai,
    pineconeKeySet: pinecone,
    pineconeIndexSet: index,
    message: ok
      ? 'All keys and PINECONE_INDEX are set.'
      : 'Missing: ' + [!anthropic && 'ANTHROPIC_API_KEY', !openai && 'OPENAI_API_KEY', !pinecone && 'PINECONE_API_KEY', !index && 'PINECONE_INDEX'].filter(Boolean).join(', ')
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
      
      // Retrieve relevant experience (optional: if Pinecone/OpenAI fails, continue without RAG)
      let relevantExperiences = [];
      try {
        relevantExperiences = await retrieveRelevantExperience(jobDescription, 3);
        console.log('✅ Retrieved relevant experience');
        console.log(formatExperienceForPrompt(relevantExperiences));
      } catch (retrievalError) {
        console.error('⚠️ Retrieval failed, continuing without RAG:', retrievalError.message || retrievalError);
      }
      const experienceContext = formatExperienceForPrompt(relevantExperiences);
      
      // Enhanced prompt with RAG context
      const prompt = `You are helping me prepare for a Product Manager interview.

JOB DESCRIPTION:
${jobDescription}

${experienceContext}

Your task:
1. First, extract from the job description above. Output exactly these two lines at the start of your response (nothing else before them):
   JOB_TITLE: <the job title or role name>
   COMPANY: <the company or organization name>
   Then a blank line.
2. Then output exactly 5 behavioral interview questions. Each question must ask about past experience (STAR: Situation, Task, Action, Result).
   Exactly 5 lines. Each line starts with "1." or "2." or "3." or "4." or "5." followed by one question.
   Each question should tie the job description to the candidate's experience above. Make them specific. Reference their real achievements where relevant.
   No section titles, no headings, no extra text. Start the questions with "1." and end with "5."`;

      // Call Claude (current model IDs: claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5)
      const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          messages: [{
              role: 'user',
              content: prompt
          }]
      });
      
      const content = response.content && response.content[0];
      const text = content && content.text;
      if (!text || typeof text !== 'string') {
        console.error('Unexpected API response:', { content: response.content });
        return res.status(502).json({ error: 'Invalid response from AI. Please try again.' });
      }
      // Parse extracted job title and company from first lines
      let jobTitle = '';
      let company = '';
      let questionsText = text;
      const titleMatch = text.match(/JOB_TITLE:\s*(.+?)(?:\n|$)/i);
      const companyMatch = text.match(/COMPANY:\s*(.+?)(?:\n|$)/i);
      if (titleMatch) {
        jobTitle = titleMatch[1].trim();
        questionsText = text.replace(/JOB_TITLE:\s*.+?(?:\n|$)/i, '').trim();
      }
      if (companyMatch) {
        company = companyMatch[1].trim();
        questionsText = questionsText.replace(/COMPANY:\s*.+?(?:\n|$)/i, '').trim();
      }
      // Trim any leading blank lines from questions block
      questionsText = questionsText.replace(/^\s*\n+/, '');
      // Split by numbered lines (1. 2. 3. etc.) so multi-line questions stay together
      const rawBlocks = questionsText.split(/\n\s*\d+[\.\)]\s*/);
      const isHeading = (s) => s.length < 60 || /interview questions for .* role$/i.test(s) || /^(regional|execution|behavioral)\s+(growth|strategy|questions?)/i.test(s);
      let questions = rawBlocks
        .map((q) => q.replace(/^\d+[\.\)]\s*/, '').trim().replace(/\n+/g, ' '))
        .filter((q) => q.length > 15 && !isHeading(q))
        .slice(0, 5);
      if (questions.length === 0) {
        questions = questionsText.split('\n').map((q) => q.replace(/^\d+[\.\)]\s*/, '').trim()).filter((q) => q.length > 15 && !isHeading(q)).slice(0, 5);
      }

      // Raw average of experience scores (Pinecone similarity, typically 0.4-0.55)
      const rawAvg = relevantExperiences.length
        ? relevantExperiences.reduce((sum, exp) => sum + exp.score, 0) / relevantExperiences.length
        : 0;
      const rawMax = relevantExperiences.length ? Math.max(...relevantExperiences.map(e => e.score)) : 0;
      // Scale to holistic "profile match" range (align with how other tools report ~70-80% for good fits)
      const overallMatch = relevantExperiences.length
        ? Math.min(0.95, 0.15 + (0.5 * rawMax + 0.5 * rawAvg) * 1.25)
        : 0;

      res.json({ 
          questions,
          jobTitle: jobTitle || null,
          company: company || null,
          overallMatch,
          relevantExperiences: relevantExperiences.map(exp => ({
              role: exp.role,
              company: exp.company,
              score: exp.score
          }))
      });
      
  } catch (error) {
      // Log full error so you can see the real cause in the terminal
      console.error('Error generating questions:', error);
      if (error && typeof error === 'object') {
        try {
          console.error('Error dump:', JSON.stringify({
            name: error.name,
            message: error.message,
            status: error.status,
            code: error.code,
            error: error.error,
            type: error.type
          }, null, 2));
        } catch (_) {}
      }
      const msg = error && (
        (error.error && error.error.error && error.error.error.message) ||
        (error.error && error.error.message) ||
        error.message ||
        (typeof error.error === 'string' && error.error) ||
        (error.body && error.body.error && error.body.error.message) ||
        (error.status && `API error ${error.status}`) ||
        (typeof error.toString === 'function' ? error.toString() : null)
      );
      const message = msg && String(msg).trim() || 'Failed to generate questions. Check the terminal where you ran "node server.js" for the real error.';
      res.status(500).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
