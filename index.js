require('dotenv').config();
const express = require('express');
const { Configuration, OpenAIApi } = require('openai');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { body, validationResult } = require('express-validator');

const app = express();

// Security middleware
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

// Rate limiting (100 requests per 15 minutes)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Root route to handle GET /
app.get('/', (req, res) => {
  res.send('Welcome to the Youtube Video Summarizer API! Use the /summarize endpoint.');
});

// Initialize OpenAI with error handling
let openai;
try {
  const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  });
  openai = new OpenAIApi(configuration);
} catch (error) {
  console.error('OpenAI Configuration Error:', error.message);
  process.exit(1);
}

// Validation and sanitization middleware
const validateRequest = [
  body('videoTranscript')
    .isString().withMessage('Transcript must be a string')
    .trim()
    .isLength({ min: 50, max: 15000 }).withMessage('Transcript must be between 50 and 15000 characters'),
  body('summaryType')
    .optional()
    .isIn(['concise', 'detailed', 'bullet-points']).withMessage('Invalid summary type'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];

// Improved summarization endpoint
app.post('/summarize', validateRequest, async (req, res) => {
  const { videoTranscript, summaryType = 'detailed' } = req.body;

  try {
    // Dynamic prompt based on summary type
    const prompt = buildSummaryPrompt(videoTranscript, summaryType);
    
    const startTime = Date.now();
    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: [
        { 
          role: 'system', 
          content: 'You are an expert video summarizer. Extract key points, maintain context, and preserve important details.' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3, // Lower for more deterministic results
      max_tokens: 1000,
    });

    const processingTime = Date.now() - startTime;
    const summary = response.data.choices[0].message.content;

    res.json({ 
      summary,
      metadata: {
        model: 'gpt-3.5-turbo',
        summaryType,
        processingTime: `${processingTime}ms`,
        transcriptLength: videoTranscript.length
      }
    });
  } catch (error) {
    console.error('Summarization Error:', error.response?.data || error.message);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({ 
      error: 'Failed to summarize',
      details: error.response?.data?.error?.message || error.message
    });
  }
});

// Helper function to build dynamic prompts
function buildSummaryPrompt(transcript, type) {
  const prompts = {
    'concise': `Provide a concise 3-4 sentence summary of this video transcript:\n${transcript}`,
    'detailed': `Create a detailed summary of this video transcript. Include key points, important arguments, and any data mentioned. Structure it in paragraphs:\n${transcript}`,
    'bullet-points': `Extract the main points from this video transcript as bullet points. Include timestamps if available:\n${transcript}`
  };
  return prompts[type] || prompts['detailed'];
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
