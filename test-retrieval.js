const { retrieveRelevantExperience, formatExperienceForPrompt } = require('./retrieval');

async function testRetrieval() {
    console.log('🧪 Testing Retrieval System\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const testCases = [
        {
            name: "Multimodal AI Role",
            jd: "Staff PM requiring multimodal AI and computer vision experience with production ML systems"
        },
        {
            name: "E-commerce Role", 
            jd: "Product Manager for e-commerce platform with growth and experimentation experience"
        },
        {
            name: "Technical AI PM",
            jd: "Technical PM with RAG architecture and LLM evaluation expertise"
        }
    ];
    
    for (const testCase of testCases) {
        console.log(`📋 TEST: ${testCase.name}`);
        console.log(`Job Description: "${testCase.jd}"\n`);
        
        const results = await retrieveRelevantExperience(testCase.jd, 3);
        
        console.log('Retrieved Experiences:\n');
        results.forEach((exp, i) => {
            console.log(`${i + 1}. ${exp.role} at ${exp.company}`);
            console.log(`   📊 Relevance: ${(exp.score * 100).toFixed(1)}%`);
            console.log(`   🎯 Category: ${exp.category}`);
            console.log(`   💡 Achievement: ${exp.achievement.substring(0, 80)}...`);
            console.log('');
        });
        
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }
    
    console.log('✅ Retrieval tests complete!\n');
}

testRetrieval().catch(console.error);