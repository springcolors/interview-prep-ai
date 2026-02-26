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
        
        // Query Pinecone
        const queryResponse = await index.query({
            vector: queryEmbedding,
            topK: topK,
            includeMetadata: true
        });
        
        // Format results
        const results = queryResponse.matches.map(match => ({
            score: match.score,
            role: match.metadata.role,
            company: match.metadata.company,
            duration: match.metadata.duration,
            category: match.metadata.category,
            skills: match.metadata.skills,
            achievement: match.metadata.achievement,
            fullText: match.metadata.fullText
        }));
        
        console.log(`✅ Found ${results.length} relevant experiences`);
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