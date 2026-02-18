# Interview Prep AI

## What this tool does

Interview Prep AI is a simple web app that helps you prepare for product management behavioral interviews. You paste a job description, and it uses Claude to generate **5 tailored behavioral interview questions** (STAR-style) tied to the skills and requirements in that job description.

## How to install and run it locally

1. **Clone the repo**
   ```bash
   git clone https://github.com/springcolors/interview-prep-ai.git
   cd interview-prep-ai
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set your API key**  
   Create a `.env` file in the project root with your Anthropic API key:
   ```
   ANTHROPIC_API_KEY=your_key_here
   ```

4. **Start the server**
   ```bash
   npm start
   ```

5. **Open the app**  
   In your browser go to [http://localhost:3000](http://localhost:3000). Paste a job description and click **Generate questions**.

## Technologies used

- **Express** – Node.js server and API routes
- **Claude API** (Anthropic) – Generates questions via `claude-sonnet-4-6`
- **Vanilla JS** – Frontend (no framework); fetch to `/api/generate-questions`

## Current status

**v0.1** – Basic functionality: single request with job description, returns 5 behavioral PM questions. Health check at `/api/health`.

## Future improvements planned

- Save and organize questions by job/company
- Practice mode with follow-up prompts or scoring
- Support for different question types (e.g. product sense, estimation)
- Optional auth so each user has their own question history
