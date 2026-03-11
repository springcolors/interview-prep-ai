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
      
      // Enhanced prompt: sectioned questions by category (like recruiter screen, technical, cross-functional, etc.)
      const prompt = `You are helping me prepare for a Product Manager interview.

JOB DESCRIPTION:
${jobDescription}

${experienceContext}

Your task:
1. First, extract from the job description. Output exactly these two lines at the start (nothing else before them):
   JOB_TITLE: <the job title or role name>
   COMPANY: <the company or organization name>
   Then a blank line.

2. Then output interview questions grouped by section. Use markdown section headers and list format.

   Use these sections (include only sections that fit the JD; you may omit or add one if the JD strongly emphasizes something else):
   - Recruiter Screen
   - Technical Expertise and Innovation
   - Cross-Functional Collaboration
   - Strategic Thinking and Problem Solving
   - User-Centered Design and Customer Advocacy

   For each section, output exactly:
     ## Section Name
     - First question here?
     - Second question here?
     (2–4 questions per section; use a blank line between sections)

   Question mix per section:
   - Include at least one behavioral question (past experience: "Describe a time...", "Tell me about a project where...") that references the candidate's actual experience above.
   - Include situational/hypothetical questions tailored to the role and company: "Imagine you are [Role] at [Company]...", "As a [Role] at [Company], how would you...?"
   - For "Recruiter Screen", start with one intro question like "Please tell me about yourself..." then 1–2 more.

   Personalize: reference the candidate's companies, roles, and achievements from RELEVANT BACKGROUND above. Tailor hypotheticals to the job's company and product names from the JD.
   Use the exact company name and role from the JD in situational questions.`;

      // Call Claude (current model IDs: claude-sonnet-4-6, claude-opus-4-6, claude-haiku-4-5)
      const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2500,
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

      // Parse sectioned format: ## Section Name\n- Q1\n- Q2\n\n## Next Section...
      let sections = [];
      const sectionBlocks = questionsText.split(/\n\s*##\s+/);
      for (const block of sectionBlocks) {
        const trimmed = block.trim();
        if (!trimmed) continue;
        const firstNewline = trimmed.indexOf('\n');
        const title = firstNewline === -1 ? trimmed : trimmed.slice(0, firstNewline).trim();
        const body = firstNewline === -1 ? '' : trimmed.slice(firstNewline + 1).trim();
        const questionLines = body.split(/\n/).map((line) => line.replace(/^\s*[-*]\s*/, '').replace(/^\s*\d+[\.\)]\s*/, '').trim()).filter((q) => q.length > 5);
        if (title && questionLines.length) sections.push({ title, questions: questionLines });
      }

      // Fallback: if no ## sections, treat whole block as one section or parse numbered list
      if (sections.length === 0) {
        const flat = questionsText.split(/\n/).map((line) => line.replace(/^\s*[-*]\s*/, '').replace(/^\s*\d+[\.\)]\s*/, '').trim()).filter((q) => q.length > 15);
        if (flat.length) sections = [{ title: 'Interview Questions', questions: flat }];
      }

      // Flat list of all questions (for backward compat and copy)
      const questions = sections.flatMap((s) => s.questions);

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
          sections: sections.length ? sections : null,
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
