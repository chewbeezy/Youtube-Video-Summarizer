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

// Rate limiting (more generous for free tier)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150, // Increased from 100 to be more generous
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    message: "Too many requests, please try again later."
  }
});
app.use(limiter);

// Welcome route with attractive response
app.get('/', (req, res) => {
  res.json({
    status: "success",
    message: "🎥 YouTube Video Summarizer API",
    description: "Free AI-powered video summarization service",
    endpoints: {
      summarize: {
        method: "POST",
        path: "/summarize",
        description: "Get AI-generated summaries from video transcripts",
        parameters: {
          videoTranscript: "string (50-15000 chars)",
          summaryType: "optional (concise|detailed|bullet-points)"
        }
      },
      health: {
        method: "GET",
        path: "/health",
        description: "Check API status"
      }
    },
    tips: [
      "Keep transcripts under 15,000 characters for best results",
      "Try different summaryTypes to get varied outputs",
      "This is a free service with rate limits (150 requests/15 mins)"
    ]
  });
});

// Initialize OpenAI
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

// Validation middleware
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
      return res.status(400).json({ 
        status: "error",
        errors: errors.array().map(err => ({
          param: err.param,
          message: err.msg
        }))
      });
    }
    next();
  }
];

// Enhanced summarization endpoint
app.post('/summarize', validateRequest, async (req, res) => {
  const { videoTranscript, summaryType = 'detailed' } = req.body;

  try {
    const prompt = buildSummaryPrompt(videoTranscript, summaryType);
    
    const startTime = Date.now();
    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: [
        { 
          role: 'system', 
          content: 'You are an expert video summarizer. Create clear, engaging summaries that capture the essence of the content.' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 1000,
    });

    const processingTime = Date.now() - startTime;
    const summary = response.data.choices[0].message.content;

    res.json({ 
      status: "success",
      data: {
        summary,
        style: summaryType,
        length: {
          original: videoTranscript.length,
          summary: summary.length,
          ratio: `${Math.round((summary.length / videoTranscript.length) * 100)}% reduction`
        }
      },
      performance: {
        processingTimeMs: processingTime,
        model: 'gpt-3.5-turbo'
      },
      tips: [
        "Like this service? Star our GitHub repo!",
        "Need longer transcripts? Contact us for enterprise options"
      ]
    });
  } catch (error) {
    console.error('Summarization Error:', error.response?.data || error.message);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({ 
      status: "error",
      message: "Failed to generate summary",
      details: error.response?.data?.error?.message || error.message,
      solution: "Please try again with a shorter transcript or different parameters"
    });
  }
});

// Helper function to build dynamic prompts
function buildSummaryPrompt(transcript, type) {
  const prompts = {
    'concise': `Provide a concise 3-4 sentence summary of this video transcript that captures the main idea and key takeaways:\n${transcript}`,
    'detailed': `Create a comprehensive summary of this video transcript. Include key points, important arguments, and any data mentioned. Structure it in well-organized paragraphs:\n${transcript}`,
    'bullet-points': `Extract the 5-7 most important points from this video transcript as clear bullet points:\n${transcript}`
  };
  return prompts[type] || prompts['detailed'];
}

// Attractive health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    resources: {
      memory: process.memoryUsage().rss / (1024 * 1024) + " MB",
      nodeVersion: process.version
    },
    message: "🚀 Ready to summarize your videos!"
  });
});

// Error handling middleware with friendly responses
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({ 
    status: "error",
    message: "Something went wrong",
    solution: "Please try again later or contact support",
    errorId: req.id
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🎥 YouTube Summarizer ready to serve!`);
});