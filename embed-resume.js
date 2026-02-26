require('dotenv').config();
const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');
const fs = require('fs');

// Initialize clients
const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function embedResume() {
    console.log('🚀 Starting resume embedding process...\n');
    
    // Load resume data
    const resumeData = JSON.parse(fs.readFileSync('resume-data.json', 'utf8'));
    const index = pinecone.index(process.env.PINECONE_INDEX);
    
    const vectors = [];
    let chunkId = 0;
    
    // Process each experience
    for (const exp of resumeData.experiences) {
        console.log(`📄 Processing: ${exp.role} at ${exp.company}`);
        
        // Create chunks for each achievement
        for (const achievement of exp.achievements) {
            // Create text to embed
            const textToEmbed = `
Role: ${exp.role}
Company: ${exp.company}
Duration: ${exp.duration}
Category: ${exp.category}
Skills: ${exp.skills.join(', ')}
Achievement: ${achievement}
            `.trim();
            
            console.log(`  ⚡ Embedding achievement ${chunkId + 1}...`);
            
            // Generate embedding
            const embeddingResponse = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: textToEmbed,
                encoding_format: 'float'  // ensure plain array for Pinecone
            });
            
            const raw = embeddingResponse.data[0].embedding;
            const embedding = Array.isArray(raw) ? raw : Array.from(raw);
            
            // Prepare vector for Pinecone
            vectors.push({
                id: `chunk_${chunkId}`,
                values: embedding,
                metadata: {
                    experienceId: exp.id,
                    role: exp.role,
                    company: exp.company,
                    duration: exp.duration,
                    category: exp.category,
                    skills: exp.skills.join(', '),
                    achievement: achievement,
                    fullText: textToEmbed
                }
            });
            
            chunkId++;
        }
    }
    
    // Upload to Pinecone (in batches of 100)
    console.log(`\n📤 Uploading ${vectors.length} vectors to Pinecone...`);
    
    const batchSize = 100;
    for (let i = 0; i < vectors.length; i += batchSize) {
        const batch = vectors.slice(i, i + batchSize);
        await index.upsert({ records: batch });
        console.log(`  ✅ Uploaded batch ${Math.floor(i / batchSize) + 1}`);
    }
    
    console.log(`\n🎉 Success! Embedded ${vectors.length} chunks from ${resumeData.experiences.length} experiences`);
    console.log('\n📊 Summary:');
    resumeData.experiences.forEach(exp => {
        console.log(`  • ${exp.role} at ${exp.company}: ${exp.achievements.length} chunks`);
    });
}

// Run it
embedResume().catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
});