const axios = require('axios');
const EmailHistory = require('../models/EmailHistory');

exports.generateEmail = async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ message: 'Prompt is required' });
    }

    if (typeof prompt !== 'string') {
      return res.status(400).json({ message: 'Prompt must be a string' });
    }

    if (prompt.trim().length === 0) {
      return res.status(400).json({ message: 'Prompt cannot be empty' });
    }

    if (prompt.length > 2000) {
      return res.status(400).json({ message: 'Prompt cannot exceed 2000 characters' });
    }

    // Call Groq API (Free tier - No quota issues!)
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      return res.status(500).json({ message: 'AI service is not configured' });
    }

    const systemPrompt = `You are an expert job outreach strategist.

Your task is to generate a HIGH-CONVERTING cold email to a recruiter for a job opportunity.

IMPORTANT:
- Even if the user gives only 2–4 words, assume realistic context.
- Do NOT ask for clarification.
- Make professional assumptions.
- Avoid generic phrases.
- Keep it concise and structured.

====================================================
OUTPUT FORMAT (STRICT)
====================================================

Return ONLY valid JSON:

{
  "subject": "",
  "emailBody": "",
  "linkedInDM": "",
  "followUpEmail": ""
}

No markdown.
No explanations.
Only JSON.

====================================================
CONTEXT ASSUMPTIONS
====================================================
Do not fabricate years of experience.

If the prompt suggests a fresher, student, graduate, or entry-level candidate,
avoid claiming professional industry experience.

When the user provides specific information
(company, branch, year, domain, skills, projects),
incorporate those details naturally into the email.

Avoid generic placeholders when user information exists.

Before generating the response:

1. Identify:
   - Target company
   - Target role
   - Candidate seniority
   - Candidate domain

2. Adapt tone and content accordingly.

3. Mention skills relevant to the inferred domain.

Infer candidate profile from the user's prompt.

If the prompt mentions:
- fresher, graduate, student → assume entry-level candidate
- VLSI, electronics, embedded, semiconductor → generate electronics-focused outreach
- software engineer, backend, frontend, full stack → generate software-focused outreach
- data science, AI, ML → generate AI/data-focused outreach

Only make assumptions when information is missing.

Never assume:
- 2+ years experience
- backend engineering
- system design
unless the prompt suggests it.

Avoid repeating the same phrases across requests.

Avoid repeatedly using:
- scalable systems
- backend APIs
- system design
- production-level features

unless directly relevant to the user's prompt.

If prompt is short like:
"SDE role"
"Backend engineer"
"Startup job"
"Product company"

Create intelligent assumptions relevant to the target domain.

Examples:
- Software → scalability, reliability, architecture
- Electronics/VLSI → design verification, digital design, semiconductor development
- Embedded → firmware, hardware-software integration
- AI/ML → model deployment, data pipelines, experimentation

Do not force software-engineering assumptions on non-software roles.

====================================================
SUBJECT LINE RULES
====================================================

• 6–9 words
• Must sound confident
• No generic phrases like:
  - "Quick question"
  - "Looking for opportunity"
  - "Job application"
• Should highlight value or experience

Example styles:
"Backend engineer with 2+ yrs scaling APIs"
"Engineer focused on scalable system design"
"Software engineer improving system performance"

====================================================
EMAIL BODY STRUCTURE (STRICT)
====================================================

Keep 60–90 words.

Line 1: Personalized observation about hiring  
Line 2: Mention common hiring/scaling challenge  
Line 3-4: Candidate's experience and strengths  
Line 5: Specific impact or contribution  
Line 6: Clear CTA  
Line 7: Sign-off with name and title  

Tone:
• Confident
• Professional
• Not desperate
• No emojis
• No hype words

====================================================
LINKEDIN DM STRUCTURE
====================================================

30–50 words.
Short, conversational.
Observation + value + soft ask.

====================================================
FOLLOW-UP EMAIL STRUCTURE
====================================================

50–80 words.
New angle.
Emphasize long-term value.
Professional urgency.
Clear CTA.

====================================================

Return ONLY valid JSON.`;
    
    const fullPrompt = `${systemPrompt}

User Prompt:
"${prompt.trim()}"

Analyze the prompt and determine:
- target company
- target role
- candidate experience level
- technical domain

Then generate personalized outreach.

Return ONLY valid JSON:
{"subject":"","emailBody":"","linkedInDM":"","followUpEmail":""}
`;
    const aiResponse = await axios.post(
  'https://api.groq.com/openai/v1/chat/completions',
  {
    model: "openai/gpt-oss-120b",
    messages: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: `User Prompt:
"${prompt.trim()}"

Analyze the prompt and determine the target company, target role, candidate experience level, and technical domain.

Then generate personalized outreach.

Return ONLY valid JSON.`
      }
    ],
    temperature: 0.7,
    max_tokens: 2048,
    response_format: {
      type: "json_object"
    }
  },
  {
    headers: {
      'Authorization': `Bearer ${groqApiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: 60000
  }
);

    // Parse the Groq response
    if (!aiResponse.data.choices || !aiResponse.data.choices[0] || !aiResponse.data.choices[0].message) {
      throw new Error('Invalid response from Groq API');
    }

    const generatedText = aiResponse.data.choices[0].message.content;
    
    // Extract JSON from the response
    const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
    let parsedResponse;
    
    try {
      parsedResponse = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(generatedText);
    } catch (parseError) {
      console.error('JSON parse error:', parseError, 'Generated text:', generatedText);
      return res.status(500).json({ 
        message: 'Failed to parse AI response', 
        error: 'The AI generated invalid JSON. Please try again.' 
      });
    }

    const emailData = {
      subject: parsedResponse.subject || "New Opportunity",
      emailBody: parsedResponse.emailBody || "",
      linkedInDM: parsedResponse.linkedInDM || "",
      followUpEmail: parsedResponse.followUpEmail || ""
    };

    // Validate response data
    if (!emailData.subject || !emailData.emailBody) {
      return res.status(500).json({ 
        message: 'AI generated incomplete email data. Please try again.' 
      });
    }

    // Save to history
    const historyEntry = await EmailHistory.create({
      userId: req.user._id,
      prompt: prompt.trim(),
      subject: emailData.subject,
      emailBody: emailData.emailBody,
      linkedInDM: emailData.linkedInDM,
      followUpEmail: emailData.followUpEmail
    });

    res.status(200).json(historyEntry);
  } catch (error) {
    console.error('AI Generation Error:', error.response?.data || error.message);
    
    if (error.response?.status === 429) {
      return res.status(429).json({ 
        message: 'Too many requests. Please wait a moment before trying again.',
        error: 'Rate limit exceeded'
      });
    }

    res.status(500).json({ 
      message: 'Failed to generate email', 
      error: error.response?.data?.error?.message || error.message 
    });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const history = await EmailHistory.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch history' });
  }
};
