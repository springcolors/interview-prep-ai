require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Anthropic } = require('@anthropic-ai/sdk');

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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY is not set in .env'
    });
  }

  // Accept either JSON { jobDescription: "..." } or plain-text body
  const jobDescription =
    (req.body && req.body.jobDescription) ||
    (typeof req.body === 'string' ? req.body : null);
  const trimmed = typeof jobDescription === 'string' ? jobDescription.trim() : '';
  if (!trimmed) {
    return res.status(400).json({
      error: 'Request body must include a non-empty job description. Send JSON: { "jobDescription": "..." } or plain text.'
    });
  }

  const prompt = `You are an expert interview coach for product management roles. Based on the following job description, generate exactly 5 behavioral interview questions.

Requirements:
1. All 5 questions must be behavioral (past experience, how you handled situations, STAR-style).
2. Tie each question to specific skills, responsibilities, or requirements mentioned in the job description—reference the JD explicitly where relevant.
3. Focus on product management scenarios (e.g. prioritization, stakeholder alignment, tradeoffs, discovery, roadmap, metrics, cross-functional work).
4. Format your response as a numbered list (1. ... 2. ... etc.). One question per line, no other text.

Job description:
${trimmed}`;

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });

    const block = message.content?.find((b) => b.type === 'text');
    const text = block?.text ?? '';
    const questions = text
      .split('\n')
      .map((q) => q.replace(/^\d+[\.\)]\s*/, '').trim())
      .filter((q) => q.length > 0)
      .slice(0, 5);

    res.json({ questions });
  } catch (err) {
    console.error('Anthropic API error:', err.message || err);
    const status = err.status ?? 502;
    const rawMessage =
      err.message ||
      (err.error && (typeof err.error === 'string' ? err.error : err.error?.message));
    const message =
      rawMessage && String(rawMessage).trim()
        ? String(rawMessage).trim()
        : `Request failed (${status}). Check ANTHROPIC_API_KEY in .env and try again.`;
    res.status(status >= 400 ? status : 502).json({
      error: message,
      status
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
