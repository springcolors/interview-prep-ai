require('dotenv').config();
const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');

// Initialize clients
const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function retrieveRelevantExperience(jobDescription, topK = 3) {
    try {
        console.log(`🔍 Searching for relevant experience...`);
        
        // Get the Pinecone index
        const index = pinecone.index(process.env.PINECONE_INDEX);
        
        // Generate embedding for job description (float format for correct dimension with Pinecone)
        const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: jobDescription,
            encoding_format: 'float'
        });
        
        const raw = embeddingResponse.data[0].embedding;
        const queryEmbedding = Array.isArray(raw) ? raw : Array.from(raw);
        
        // Query more chunks so we can aggregate by experience (topK * 3 to allow grouping)
        const queryResponse = await index.query({
            vector: queryEmbedding,
            topK: Math.min(20, topK * 5),
            includeMetadata: true
        });
        
        const chunks = (queryResponse.matches || []).map(match => ({
            score: match.score ?? 0,
            role: match.metadata?.role,
            company: match.metadata?.company,
            duration: match.metadata?.duration,
            category: match.metadata?.category,
            skills: match.metadata?.skills,
            achievement: match.metadata?.achievement,
            fullText: match.metadata?.fullText,
            experienceId: match.metadata?.experienceId
        })).filter(c => c.role && c.company);
        
        // Group by experience (role + company) and aggregate score
        const byExperience = new Map();
        for (const chunk of chunks) {
            const key = `${chunk.role}\t${chunk.company}`;
            if (!byExperience.has(key)) {
                byExperience.set(key, {
                    role: chunk.role,
                    company: chunk.company,
                    duration: chunk.duration,
                    category: chunk.category,
                    skills: chunk.skills,
                    scores: [],
                    achievements: [],
                    bestAchievement: null,
                    bestScore: 0
                });
            }
            const agg = byExperience.get(key);
            agg.scores.push(chunk.score);
            if (chunk.achievement) agg.achievements.push(chunk.achievement);
            if (chunk.score > agg.bestScore) {
                agg.bestScore = chunk.score;
                agg.bestAchievement = chunk.achievement;
            }
        }
        
        // Build one result per experience with aggregated score (average of matching chunks)
        const results = Array.from(byExperience.values())
            .map(agg => ({
                role: agg.role,
                company: agg.company,
                duration: agg.duration,
                category: agg.category,
                skills: agg.skills,
                score: agg.scores.length ? agg.scores.reduce((a, b) => a + b, 0) / agg.scores.length : 0,
                achievement: agg.bestAchievement || (agg.achievements && agg.achievements[0]) || '',
                fullText: agg.achievements?.join(' ') || ''
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
        
        console.log(`✅ Found ${results.length} unique experiences (from ${chunks.length} chunks)`);
        return results;
        
    } catch (error) {
        console.error('❌ Retrieval error:', error);
        throw error;
    }
}

function formatExperienceForPrompt(experiences) {
    if (!experiences || experiences.length === 0) {
        return "No specific relevant experience found.";
    }
    
    let formatted = "RELEVANT BACKGROUND:\n\n";
    
    experiences.forEach((exp, index) => {
        formatted += `${index + 1}. ${exp.role} at ${exp.company} (${exp.duration})\n`;
        formatted += `   Skills: ${exp.skills}\n`;
        formatted += `   Achievement: ${exp.achievement}\n`;
        formatted += `   Relevance Score: ${(exp.score * 100).toFixed(1)}%\n\n`;
    });
    
    return formatted;
}

module.exports = {
    retrieveRelevantExperience,
    formatExperienceForPrompt
};