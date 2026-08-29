async function testTaskEstimation() {
  const apiKey = process.env.LLM_API_KEY || process.env.GROQ_API_KEY;
  const baseUrl = 'https://api.groq.com/openai/v1';

  if (!apiKey) {
    throw new Error('Set LLM_API_KEY or GROQ_API_KEY before running this test');
  }

  console.log('Testing Groq LLM API Task Estimation...');
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are an expert technical project manager. Analyze the provided task description and estimate the average completion time in minutes. Output JSON only: { "estimatedTimeMinutes": number, "keyMilestones": string[] }' },
          { role: 'user', content: 'Task Title: Build OAuth2 SSO Integration\nTask Description: Implement OAuth2 login with Google and Microsoft Azure AD, configure JWT tokens, refresh handling, and unit test authorization guards.' }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' }
      })
    });

    const data = await res.json();
    console.log('Groq LLM Status:', res.status);
    console.log('Groq LLM Task Estimation Result:', JSON.parse(data?.choices?.[0]?.message?.content || '{}'));
  } catch (err) {
    console.error('Task Estimation Test Error:', err);
  }
}

async function testVisionEvaluation() {
  const apiKey = process.env.LLM_API_KEY || process.env.GROQ_API_KEY;
  const baseUrl = 'https://api.groq.com/openai/v1';

  if (!apiKey) {
    throw new Error('Set LLM_API_KEY or GROQ_API_KEY before running this test');
  }

  console.log('\nTesting Groq LLM API Vision Evaluation...');
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: `You are an automated workforce productivity evaluator. Compare the provided employee desktop screenshot with their assigned active task.
Active Task: Implement OAuth2 SSO Integration - Implement OAuth2 login with Google and Microsoft Azure AD.
Elapsed Time: 45 / Estimated: 120 mins.

Evaluate:
1. Is the employee actively working on the assigned task based on screen content? (boolean)
2. Estimated Progress Percentage (0-100%).
3. Productivity Status: 'ON_TRACK' | 'BEHIND_SCHEDULE' | 'DISTRACTED' | 'IDLE'.
4. Brief 1-sentence manager summary of current activity.

Output strictly in JSON:
{ "isTaskRelevant": boolean, "progressPercentage": number, "status": string, "summary": string }` },
          { role: 'user', content: 'Evaluate active screen window context: VS Code IDE editing auth.service.ts method handleOAuthCallback()' }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' }
      })
    });

    const data = await res.json();
    console.log('Groq Vision LLM Status:', res.status);
    console.log('Groq Vision LLM Evaluation Result:', JSON.parse(data?.choices?.[0]?.message?.content || '{}'));
  } catch (err) {
    console.error('Vision Evaluation Test Error:', err);
  }
}

testTaskEstimation().then(() => testVisionEvaluation());
